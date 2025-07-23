"use client";

import { TimerIcon } from "lucide-react";
import { useEffect, useState } from "react";
import spacetime from "spacetime";

interface TimerProps {
  until: Date;
}

interface TimeLeft {
  hours: number;
  minutes: number;
  seconds: number;
  isFinished: boolean;
}

export const Timer = ({ until }: TimerProps) => {
  const [timeLeft, setTimeLeft] = useState<TimeLeft>({
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
        setTimeLeft({ hours: 0, minutes: 0, seconds: 0, isFinished: true });
        return;
      }

      const diff = now.diff(untilDate);

      const hours =
        Math.floor(
          (diff.milliseconds % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60),
        ) +
        diff.days * 24;
      const minutes = Math.floor(
        (diff.milliseconds % (1000 * 60 * 60)) / (1000 * 60),
      );
      const seconds = Math.floor((diff.milliseconds % (1000 * 60)) / 1000);

      setTimeLeft({ hours, minutes, seconds, isFinished: false });
    };

    calculateTimeLeft();

    const timer = setInterval(calculateTimeLeft, 1000);

    return () => clearInterval(timer);
  }, [until]);

  const formatNumber = (num: number) => {
    return num.toString().padStart(2, "0");
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
          <span className="text-muted-foreground w-20">
            {formatNumber(timeLeft.hours)} : {formatNumber(timeLeft.minutes)} :{" "}
            {formatNumber(timeLeft.seconds)}
          </span>
        </>
      )}
    </div>
  );
};
