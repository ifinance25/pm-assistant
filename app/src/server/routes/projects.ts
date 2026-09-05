import { Hono } from "hono";
import { getDb } from "../../db/index.ts";

type ProjectFields = {
  name?: unknown;
  trackerProjectRef?: unknown;
  trackerParentRef?: unknown;
};

function readFields(body: ProjectFields): {
  name?: string;
  trackerProjectRef?: string;
  trackerParentRef?: string;
} {
  const patch: {
    name?: string;
    trackerProjectRef?: string;
    trackerParentRef?: string;
  } = {};
  if (typeof body.name === "string") {
    patch.name = body.name;
  }
  if (typeof body.trackerProjectRef === "string") {
    patch.trackerProjectRef = body.trackerProjectRef;
  }
  if (typeof body.trackerParentRef === "string") {
    patch.trackerParentRef = body.trackerParentRef;
  }
  return patch;
}

export const projectsRouter = new Hono();

projectsRouter.get("/", (c) => {
  const projects = getDb().listProjects();
  return c.json({ projects });
});

projectsRouter.get("/summary", (c) => {
  return c.json(getDb().listProjectsSummary());
});

projectsRouter.post("/", async (c) => {
  let body: {
    name?: unknown;
    trackerProjectRef?: unknown;
    trackerParentRef?: unknown;
  };
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    return c.json({ error: "нужен JSON" }, 400);
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return c.json({ error: "нужно имя проекта" }, 400);
  }

  const project = getDb().createProject({
    name,
    trackerProjectRef:
      typeof body.trackerProjectRef === "string" ? body.trackerProjectRef : "",
    trackerParentRef:
      typeof body.trackerParentRef === "string" ? body.trackerParentRef : "",
  });
  return c.json({ project }, 201);
});

projectsRouter.put("/batch", async (c) => {
  let body: {
    create?: unknown;
    update?: unknown;
    delete?: unknown;
  };
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    return c.json({ error: "нужен JSON" }, 400);
  }

  const create = Array.isArray(body.create)
    ? body.create.flatMap((row) => {
        if (!row || typeof row !== "object") {
          return [];
        }
        const fields = readFields(row as ProjectFields);
        if (fields.name === undefined) {
          return [];
        }
        return [
          {
            name: fields.name,
            trackerProjectRef: fields.trackerProjectRef,
            trackerParentRef: fields.trackerParentRef,
          },
        ];
      })
    : [];
  const update = Array.isArray(body.update)
    ? body.update.flatMap((row) => {
        if (!row || typeof row !== "object") {
          return [];
        }
        const rec = row as ProjectFields & { id?: unknown };
        if (typeof rec.id !== "string" || !rec.id) {
          return [];
        }
        return [{ id: rec.id, ...readFields(rec) }];
      })
    : [];
  const deletes = Array.isArray(body.delete)
    ? body.delete.filter((id): id is string => typeof id === "string" && Boolean(id))
    : [];

  const result = getDb().applyProjectsBatch({
    create,
    update,
    delete: deletes,
  });
  if (!result.ok) {
    return c.json({ error: result.error }, result.status);
  }
  return c.json({ projects: result.projects });
});

projectsRouter.put("/:id", async (c) => {
  const id = c.req.param("id");
  let body: {
    name?: unknown;
    trackerProjectRef?: unknown;
    trackerParentRef?: unknown;
  };
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    return c.json({ error: "нужен JSON" }, 400);
  }

  const patch: {
    name?: string;
    trackerProjectRef?: string;
    trackerParentRef?: string;
  } = {};
  if (typeof body.name === "string") {
    const name = body.name.trim();
    if (!name) {
      return c.json({ error: "имя проекта не может быть пустым" }, 400);
    }
    patch.name = name;
  }
  if (typeof body.trackerProjectRef === "string") {
    patch.trackerProjectRef = body.trackerProjectRef;
  }
  if (typeof body.trackerParentRef === "string") {
    patch.trackerParentRef = body.trackerParentRef;
  }

  const project = getDb().updateProject(id, patch);
  if (!project) {
    return c.json({ error: "проект не найден" }, 404);
  }
  return c.json({ project });
});

projectsRouter.delete("/:id", (c) => {
  const result = getDb().deleteProject(c.req.param("id"));
  if (result === "not_found") {
    return c.json({ error: "проект не найден" }, 404);
  }
  if (result === "has_meetings") {
    return c.json({ error: "нельзя удалить проект с расшифровками" }, 409);
  }
  return c.json({ ok: true });
});
