import { useEffect, useState } from "react";
import type { Meeting } from "../../../shared/types.ts";
import { CalendarView } from "./CalendarView.tsx";

type MeetingsResponse = {
  meetings: Meeting[];
};

export function CalendarPage() {
  const [meetings, setMeetings] = useState<Meeting[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetch("/api/meetings")
      .then((res) => {
        if (!res.ok) {
          throw new Error("load");
        }
        return res.json() as Promise<MeetingsResponse>;
      })
      .then((body) => {
        setMeetings(body.meetings);
        setError(null);
      })
      .catch(() => {
        setError("Не удалось загрузить встречи");
      });
  }, []);

  if (meetings === null) {
    return (
      <section className="calendar">
        <h1 className="calendar__title">{error ?? "Загрузка календаря..."}</h1>
      </section>
    );
  }

  return (
    <>
      {error ? <p className="calendar__error">{error}</p> : null}
      <CalendarView meetings={meetings} />
    </>
  );
}
