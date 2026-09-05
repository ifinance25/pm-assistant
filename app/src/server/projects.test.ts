import { afterEach, describe, expect, it } from "vitest";
import { app } from "./app.ts";
import { authHeaders, setupAuthedDb } from "./test-auth.ts";

describe("Projects API", () => {
  let db: ReturnType<typeof setupAuthedDb>["db"];
  let auth: ReturnType<typeof setupAuthedDb>["auth"];

  afterEach(() => {
    db?.close();
  });

  function jsonHeaders(): Record<string, string> {
    return authHeaders(auth, { "content-type": "application/json" });
  }

  it("GET /api/projects возвращает seed «Свои» с meetingCount", async () => {
    ({ db, auth } = setupAuthedDb());
    const res = await app.request("/api/projects", {
      headers: authHeaders(auth),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      projects: Array<{ name: string; meetingCount?: number }>;
    };
    expect(body.projects).toHaveLength(1);
    expect(body.projects[0].name).toBe("Свои");
    expect(body.projects[0].meetingCount).toBe(0);
  });

  it("GET /api/projects/summary считает проекты и встречи", async () => {
    ({ db, auth } = setupAuthedDb());
    const defaultProject = db.getDefaultProject();
    db.createMeeting({ url: "https://zoom.us/j/111", projectId: defaultProject.id });
    const res = await app.request("/api/projects/summary", {
      headers: authHeaders(auth),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      projectCount: number;
      meetingCount: number;
      projects: Array<{ name: string; meetingCount: number; lastMeeting: unknown }>;
    };
    expect(body.projectCount).toBe(1);
    expect(body.meetingCount).toBe(1);
    expect(body.projects[0].meetingCount).toBe(1);
    expect(body.projects[0].lastMeeting).toMatchObject({
      status: "queued",
    });
  });

  it("POST /api/projects создаёт проект", async () => {
    ({ db, auth } = setupAuthedDb());
    const res = await app.request("/api/projects", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        name: "Клиент А",
        trackerProjectRef: "PROJ-1",
        trackerParentRef: "EPIC-2",
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { project: { name: string } };
    expect(body.project.name).toBe("Клиент А");
    expect(db.listProjects()).toHaveLength(2);
  });

  it("PUT /api/projects/:id обновляет поля", async () => {
    ({ db, auth } = setupAuthedDb());
    const created = db.createProject({ name: "Draft" });
    const res = await app.request(`/api/projects/${created.id}`, {
      method: "PUT",
      headers: jsonHeaders(),
      body: JSON.stringify({ name: "Клиент B", trackerProjectRef: "X-1" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      project: { name: string; trackerProjectRef: string };
    };
    expect(body.project.name).toBe("Клиент B");
    expect(body.project.trackerProjectRef).toBe("X-1");
  });

  it("DELETE /api/projects/:id возвращает 409 если есть встречи", async () => {
    ({ db, auth } = setupAuthedDb());
    const project = db.createProject({ name: "С встречами" });
    db.createMeeting({ url: "https://zoom.us/j/222", projectId: project.id });
    const res = await app.request(`/api/projects/${project.id}`, {
      method: "DELETE",
      headers: authHeaders(auth),
    });
    expect(res.status).toBe(409);
  });

  it("DELETE /api/projects/:id удаляет пустой проект", async () => {
    ({ db, auth } = setupAuthedDb());
    const project = db.createProject({ name: "Пустой" });
    const res = await app.request(`/api/projects/${project.id}`, {
      method: "DELETE",
      headers: authHeaders(auth),
    });
    expect(res.status).toBe(200);
    expect(db.getProject(project.id)).toBeNull();
  });

  it("PUT /api/projects/batch создаёт, обновляет и удаляет в одном запросе", async () => {
    ({ db, auth } = setupAuthedDb());
    const draft = db.createProject({ name: "Черновик", trackerProjectRef: "old" });
    const doomed = db.createProject({ name: "К удалению" });
    const res = await app.request("/api/projects/batch", {
      method: "PUT",
      headers: jsonHeaders(),
      body: JSON.stringify({
        create: [{ name: "Клиент C", trackerProjectRef: "C-1", trackerParentRef: "P-1" }],
        update: [{ id: draft.id, name: "Черновик 2", trackerProjectRef: "new" }],
        delete: [doomed.id],
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      projects: Array<{ name: string; trackerProjectRef: string }>;
    };
    const names = body.projects.map((project) => project.name);
    expect(names).toContain("Свои");
    expect(names).toContain("Клиент C");
    expect(names).toContain("Черновик 2");
    expect(names).not.toContain("К удалению");
    expect(db.getProject(draft.id)?.trackerProjectRef).toBe("new");
  });

  it("PUT /api/projects/batch возвращает 409 если удаляемый проект с встречами", async () => {
    ({ db, auth } = setupAuthedDb());
    const project = db.createProject({ name: "С встречами" });
    db.createMeeting({ url: "https://zoom.us/j/333", projectId: project.id });
    const res = await app.request("/api/projects/batch", {
      method: "PUT",
      headers: jsonHeaders(),
      body: JSON.stringify({ delete: [project.id] }),
    });
    expect(res.status).toBe(409);
    expect(db.getProject(project.id)).not.toBeNull();
  });

  it("PUT /api/projects/batch с пустым name в create возвращает 400", async () => {
    ({ db, auth } = setupAuthedDb());
    const res = await app.request("/api/projects/batch", {
      method: "PUT",
      headers: jsonHeaders(),
      body: JSON.stringify({ create: [{ name: "   " }] }),
    });
    expect(res.status).toBe(400);
  });

  it("без сессии возвращает 401", async () => {
    ({ db, auth } = setupAuthedDb());
    const res = await app.request("/api/projects");
    expect(res.status).toBe(401);
  });
});
