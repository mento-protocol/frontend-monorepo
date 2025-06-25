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
}

export const Timer = ({ until }: TimerProps) => {
  const [timeLeft, setTimeLeft] = useState<TimeLeft>({
    hours: 0,
    minutes: 0,
    seconds: 0,
  });

  useEffect(() => {
    const calculateTimeLeft = () => {
      const now = spacetime.now();
      const untilDate = spacetime(until);

      if (now.isAfter(untilDate)) {
        setTimeLeft({ hours: 0, minutes: 0, seconds: 0 });
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

      setTimeLeft({ hours, minutes, seconds });
    };

    calculateTimeLeft();

    const timer = setInterval(calculateTimeLeft, 1000);

    return () => clearInterval(timer);
  }, [until]);

  const formatNumber = (num: number) => {
    return num.toString().padStart(2, "0");
  };

  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="flex items-center gap-1">
        <TimerIcon size={16} />
        Time left:
      </span>
      <span className="text-muted-foreground w-20">
        {formatNumber(timeLeft.hours)} : {formatNumber(timeLeft.minutes)} :{" "}
        {formatNumber(timeLeft.seconds)}
      </span>
    </div>
  );
};
