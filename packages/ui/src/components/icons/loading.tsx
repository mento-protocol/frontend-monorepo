import React, { useEffect, useRef } from "react";
import { createTimeline } from "animejs";

interface LoadingProps extends React.SVGProps<SVGSVGElement> {
  fill?: string;
}

const Loading: React.FC<LoadingProps> = ({ fill = "black", ...props }) => {
  const rect1Ref = useRef<SVGRectElement>(null);
  const rect2Ref = useRef<SVGRectElement>(null);
  const rect3Ref = useRef<SVGRectElement>(null);

  useEffect(() => {
    // Create staggered animation for the three rectangles
    const timeline = createTimeline({
      loop: true,
      defaults: {
        ease: "inOutQuad",
      },
    });

    if (!rect1Ref.current || !rect2Ref.current || !rect3Ref.current) {
      return;
    }

    timeline
      .add(rect1Ref.current, {
        opacity: [0.3, 1],
        scale: [0.8, 1.2, 1],
        duration: 400,
        endDelay: 150,
      })
      .add(
        rect2Ref.current,
        {
          opacity: [0.3, 1],
          scale: [0.8, 1.2, 1],
          duration: 400,
          endDelay: 150,
        },
        "-=300",
      )
      .add(
        rect3Ref.current,
        {
          opacity: [0.3, 1],
          scale: [0.8, 1.2, 1],
          duration: 400,
          endDelay: 150,
        },
        "-=300",
      )
      .add([rect1Ref.current, rect2Ref.current, rect3Ref.current], {
        opacity: 0.3,
        scale: 0.8,
        duration: 400,
        ease: "outQuad",
      });

    // Cleanup function
    return () => {
      timeline.pause();
    };
  }, []);

  return (
    <svg
      width="24"
      height="25"
      viewBox="0 0 24 25"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <rect
        ref={rect1Ref}
        x="2"
        y="10.5"
        width="4"
        height="4"
        fill="#8D8B93"
        style={{
          transformOrigin: "4px 12.5px",
          opacity: 0.3,
        }}
      />
      <rect
        ref={rect2Ref}
        x="10"
        y="10.5"
        width="4"
        height="4"
        fill="#8D8B93"
        style={{
          transformOrigin: "12px 12.5px",
          opacity: 0.3,
        }}
      />
      <rect
        ref={rect3Ref}
        x="18"
        y="10.5"
        width="4"
        height="4"
        fill="white"
        style={{
          transformOrigin: "20px 12.5px",
          opacity: 0.3,
        }}
      />
    </svg>
  );
};

export default Loading;
