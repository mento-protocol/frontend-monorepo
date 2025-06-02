"use client";

import Link from "next/link";

export const navLinks = [
  { label: "Swap", to: "/" },
  { label: "About", to: "/about" },
];

export function NavBar({ pathName }: { pathName: string }) {
  return (
    <nav>
      <ul className="mr-3 flex list-none items-center justify-center overflow-hidden rounded-full bg-white opacity-90 shadow-md">
        {navLinks.map((l, i) => {
          const isLast = i === navLinks.length - 1;
          const active = pathName === l.to;
          const padding = `py-1.5 px-3 md:px-5 ${i === 0 && "pl-4 md:pl-6"} ${
            isLast && "pr-4 md:pr-6"
          }`;
          const colors = ` ${active && "bg-gray-100"} hover:bg-gray-50 ${
            active ? "font-medium" : "font-base"
          }`;
          const border = !isLast ? "border-r border-gray-100" : "";
          const className = `${padding} ${colors} ${border}`;
          return (
            <li key={l.label} className="flex items-center justify-center">
              <Link href={l.to} className={className}>
                {l.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
