"use client";

import { useState } from "react";
import { Button } from "@repo/ui";

// Instead of using the Button component that has type issues,
// let's create a basic button with the same styling
export function ButtonGroup() {
  const [clicked, setClicked] = useState(false);

  return (
    <div className="flex flex-col items-center space-y-4">
      <div className="flex justify-center gap-4">
        <Button
          variant="default"
          onClick={() => setClicked(true)}
          type="button"
        >
          Default Button
        </Button>
        <Button
          variant="secondary"
          onClick={() => setClicked(false)}
          type="button"
        >
          Secondary Button
        </Button>
      </div>

      {clicked && (
        <div className="mt-4 rounded-md bg-blue-100 p-4 text-blue-700">
          You clicked the button!
        </div>
      )}
    </div>
  );
}
