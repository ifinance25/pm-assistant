import { useState } from "react";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { ru } from "date-fns/locale";

const WEEKDAY_LABELS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

export type MonthGridProps = {
  today?: Date;
  initialMonth?: Date;
  onSelectDay?: (day: Date | null) => void;
};

function monthTitle(month: Date): string {
  const raw = format(month, "LLLL yyyy", { locale: ru });
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

export function MonthGrid({ today = new Date(), initialMonth, onSelectDay }: MonthGridProps) {
  const [month, setMonth] = useState(initialMonth ?? today);
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);

  const gridStart = startOfWeek(startOfMonth(month), { weekStartsOn: 1 });
  const gridEnd = endOfWeek(endOfMonth(month), { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });

  function selectDay(day: Date) {
    const next = selectedDay && isSameDay(selectedDay, day) ? null : day;
    setSelectedDay(next);
    onSelectDay?.(next);
  }

  return (
    <div className="month-grid">
      <div className="month-grid__header">
        <button
          type="button"
          className="month-grid__nav"
          aria-label="Предыдущий месяц"
          onClick={() => setMonth((m) => addMonths(m, -1))}
        >
          ‹
        </button>
        <span className="month-grid__title">{monthTitle(month)}</span>
        <button
          type="button"
          className="month-grid__nav"
          aria-label="Следующий месяц"
          onClick={() => setMonth((m) => addMonths(m, 1))}
        >
          ›
        </button>
      </div>
      <div className="month-grid__weekdays">
        {WEEKDAY_LABELS.map((label) => (
          <span key={label} className="month-grid__weekday">
            {label}
          </span>
        ))}
      </div>
      <div className="month-grid__days">
        {days.map((day) => {
          if (!isSameMonth(day, month)) {
            return (
              <div
                key={day.toISOString()}
                className="month-grid__day month-grid__day--empty"
                aria-hidden="true"
              />
            );
          }
          const isTodayCell = isSameDay(day, today);
          const isSelected = selectedDay ? isSameDay(day, selectedDay) : false;
          const className = [
            "month-grid__day",
            isTodayCell && "month-grid__day--today",
            isSelected && !isTodayCell && "month-grid__day--selected",
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <button
              type="button"
              key={day.toISOString()}
              className={className}
              onClick={() => selectDay(day)}
            >
              {format(day, "d")}
            </button>
          );
        })}
      </div>
    </div>
  );
}
