import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "./ui/button";
import { cn } from "@/lib";

interface CopyToClipboardProps {
  text: string;
  className?: string;
  toastMsg?: string;
}

export const CopyToClipboard = ({
  text,
  className,
  toastMsg,
}: CopyToClipboardProps) => {
  const [copied, setCopied] = useState<string | null>(null);

  const handleCopyAddress = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    try {
      navigator.clipboard.writeText(text);
      toast.success(toastMsg || "Address copied to clipboard", {
        duration: 2000,
      });
      setCopied(text);
      setTimeout(() => {
        setCopied(null);
      }, 2000);
    } catch (error) {
      console.error("Failed to copy address", error);
    }
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn(
        "h-5 w-5 text-secondary-active hover:!bg-transparent hover:text-secondary-active/75",
        className,
      )}
      onClick={handleCopyAddress}
    >
      {copied === text ? (
        <Check className="h-5 w-5" />
      ) : (
        <Copy className="h-5 w-5" />
      )}
    </Button>
  );
};
