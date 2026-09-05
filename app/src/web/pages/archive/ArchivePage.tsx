import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { MeetingDetail, Project } from "../../../shared/types.ts";
import {
  ArchiveView,
  durationLabel,
  hitsFromSearch,
  type ArchiveContext,
  type ArchiveFilters,
  type ArchiveHit,
  type ArchiveProjectChip,
  type SearchHit,
} from "./ArchiveView.tsx";

function countLines(text: string | undefined): number {
  if (!text) {
    return 0;
  }
  return text
    .split(/\n+/)
    .map((line) => line.replace(/^[-•]\s*/, "").trim())
    .filter(Boolean).length;
}

function matchCount(detail: MeetingDetail, query: string): number {
  const needle = query.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  if (!needle) {
    return detail.transcript.length;
  }
  const blobs = [
    ...detail.transcript.map((segment) => segment.text),
    detail.summary?.headline ?? "",
    detail.summary?.decisions ?? "",
    detail.summary?.risks ?? "",
    detail.summary?.nextStep ?? "",
    ...detail.actionItems.map((item) => item.title),
    detail.meeting.title ?? "",
  ];
  const hits = blobs.filter((text) => text.toLowerCase().includes(needle)).length;
  return Math.max(hits, 1);
}

function contextFrom(
  hit: ArchiveHit,
  detail: MeetingDetail | null,
  query: string,
): ArchiveContext {
  return {
    id: hit.id,
    title: hit.title ?? "Встреча без названия",
    platform: hit.platform,
    startedAt: hit.startedAt,
    durationLabel: detail
      ? durationLabel(
          detail.meeting.startedAt,
          detail.meeting.endedAt,
          detail.meeting.status,
        )
      : durationLabel(hit.startedAt, hit.endedAt, hit.status),
    snippet: hit.snippet,
    href: hit.href,
    projectName: hit.projectName ?? null,
    epicKey: hit.epicKey ?? null,
    fragmentCount: detail ? matchCount(detail, query) : hit.matchCount,
    decisionCount: detail
      ? countLines(detail.summary?.decisions)
      : hit.decisionCount,
    taskCount: detail ? detail.actionItems.length : hit.taskCount,
  };
}

async function loadDetail(id: string): Promise<MeetingDetail | null> {
  const res = await fetch(`/api/meetings/${id}`);
  if (!res.ok) {
    return null;
  }
  return (await res.json()) as MeetingDetail;
}

export function ArchivePage() {
  const [params, setParams] = useSearchParams();
  const query = params.get("q") ?? "";
  const initialProjectId = params.get("projectId") ?? "";
  const [filters, setFilters] = useState<ArchiveFilters>({
    platform: "",
    period: "",
    status: "",
    projectId: initialProjectId,
  });
  const [projects, setProjects] = useState<ArchiveProjectChip[]>([]);
  const [results, setResults] = useState<ArchiveHit[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<ArchiveContext | null>(null);
  const [loading, setLoading] = useState(false);
  const [meetingCount, setMeetingCount] = useState(0);
  const selectedIdRef = useRef<string | null>(null);

  useEffect(() => {
    void fetch("/api/projects")
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { projects?: Project[] } | null) => {
        if (!body?.projects) {
          return;
        }
        setProjects(
          body.projects.map((project) => ({
            id: project.id,
            name: project.name,
          })),
        );
      });
  }, []);

  useEffect(() => {
    void fetch("/api/meetings")
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { storage?: { meetingCount?: number } } | null) => {
        if (typeof body?.storage?.meetingCount === "number") {
          setMeetingCount(body.storage.meetingCount);
        }
      });
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    const q = query.trim();
    setLoading(true);
    const search = new URLSearchParams();
    if (q) {
      search.set("q", q);
    }
    if (filters.status) {
      search.set("status", filters.status);
    }
    if (filters.projectId) {
      search.set("projectId", filters.projectId);
    }
    const qs = search.toString();
    fetch(`/api/search${qs ? `?${qs}` : ""}`, { signal: ac.signal })
      .then(async (res) => {
        if (!res.ok) {
          return [];
        }
        const body = (await res.json()) as { results?: SearchHit[] };
        const hits = Array.isArray(body.results) ? body.results : [];
        return hitsFromSearch(hits).sort((a, b) => {
          const aTime = a.startedAt ? Date.parse(a.startedAt) : 0;
          const bTime = b.startedAt ? Date.parse(b.startedAt) : 0;
          return bTime - aTime;
        });
      })
      .then(async (hits) => {
        if (ac.signal.aborted) {
          return;
        }
        setResults(hits);
        const keepId = selectedIdRef.current;
        const nextId =
          keepId && hits.some((hit) => hit.id === keepId)
            ? keepId
            : (hits[0]?.id ?? null);
        selectedIdRef.current = nextId;
        setSelectedId(nextId);
        const nextHit = hits.find((hit) => hit.id === nextId) ?? null;
        if (!nextHit) {
          setSelected(null);
          return;
        }
        setSelected(contextFrom(nextHit, null, q));
        const detail = await loadDetail(nextHit.id);
        if (ac.signal.aborted) {
          return;
        }
        setSelected(contextFrom(nextHit, detail, q));
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") {
          return;
        }
        setResults([]);
        setSelectedId(null);
        setSelected(null);
      })
      .finally(() => {
        if (!ac.signal.aborted) {
          setLoading(false);
        }
      });
    return () => ac.abort();
  }, [query, filters.status, filters.projectId]);

  function onToggleFilter(group: keyof ArchiveFilters, id: string) {
    setFilters((current) => ({
      ...current,
      [group]: current[group] === id ? "" : id,
    }));
  }

  function onSelect(id: string) {
    const hit = results.find((item) => item.id === id);
    if (!hit) {
      return;
    }
    selectedIdRef.current = id;
    setSelectedId(id);
    setSelected(contextFrom(hit, null, query));
    void loadDetail(id).then((detail) => {
      setSelected(contextFrom(hit, detail, query));
    });
  }

  function onQuerySubmit(nextQuery: string) {
    const next = new URLSearchParams();
    if (nextQuery) {
      next.set("q", nextQuery);
    }
    setParams(next, { replace: true });
  }

  return (
    <ArchiveView
      query={query}
      filters={filters}
      projects={projects}
      results={results}
      selectedId={selectedId}
      selected={selected}
      meetingCount={meetingCount}
      projectCount={projects.length}
      loading={loading}
      onToggleFilter={onToggleFilter}
      onSelect={onSelect}
      onQuerySubmit={onQuerySubmit}
    />
  );
}
