"use client";

import { TimerIcon } from "lucide-react";
import { useEffect, useState } from "react";
import spacetime from "spacetime";

interface TimerProps {
  until: Date;
}

interface TimeLeft {
  weeks: number;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  isFinished: boolean;
}

export const Timer = ({ until }: TimerProps) => {
  const [timeLeft, setTimeLeft] = useState<TimeLeft>({
    weeks: 0,
    days: 0,
    hours: 0,
    minutes: 0,
    seconds: 0,
    isFinished: false,
  });

  useEffect(() => {
    const calculateTimeLeft = () => {
      const now = spacetime.now();
      const untilDate = spacetime(until);

      if (now.isAfter(untilDate)) {
        setTimeLeft({
          weeks: 0,
          days: 0,
          hours: 0,
          minutes: 0,
          seconds: 0,
          isFinished: true,
        });
        return;
      }

      // Use untilDate.diff(now) to get a positive time difference
      const diff = untilDate.diff(now);

      // Calculate time units
      const totalSeconds = Math.floor(Math.abs(diff.milliseconds) / 1000);
      const totalMinutes = Math.floor(totalSeconds / 60);
      const totalHours = Math.floor(totalMinutes / 60);
      const totalDays = Math.floor(totalHours / 24);

      const weeks = Math.floor(totalDays / 7);
      const days = totalDays % 7;
      const hours = totalHours % 24;
      const minutes = totalMinutes % 60;
      const seconds = totalSeconds % 60;

      setTimeLeft({ weeks, days, hours, minutes, seconds, isFinished: false });
    };

    calculateTimeLeft();

    const timer = setInterval(calculateTimeLeft, 1000);

    return () => clearInterval(timer);
  }, [until]);

  const formatTimeLeft = () => {
    const { weeks, days, hours, minutes, seconds } = timeLeft;

    // Format based on the largest non-zero unit
    if (weeks > 0) {
      return `${weeks}w ${days}d ${hours}h`;
    } else if (days > 0) {
      return `${days}d ${hours}h ${minutes}m`;
    } else if (hours > 0) {
      return `${hours}h ${minutes}m ${seconds}s`;
    } else {
      return `${minutes}m ${seconds}s`;
    }
  };

  const formatFinishDate = () => {
    const finishDate = spacetime(until);
    return finishDate.format("{date-ordinal} {month}, {year}");
  };

  return (
    <div className="flex items-center gap-2">
      {timeLeft.isFinished ? (
        <div className="flex items-center gap-1">
          <TimerIcon size={16} />
          <div className="flex items-center gap-2">
            <span>Finished</span>
            <span className="text-muted-foreground">{formatFinishDate()}</span>
          </div>
        </div>
      ) : (
        <>
          <span className="flex items-center gap-1">
            <TimerIcon size={16} />
            Time left:
          </span>
          <span className="text-muted-foreground">{formatTimeLeft()}</span>
        </>
      )}
    </div>
  );
};
