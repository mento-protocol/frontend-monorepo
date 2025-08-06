"use client";
import { useProposals, useProposalThreshold, useTokens } from "@repo/web3";
import { formatUnitsWithThousandSeparators } from "@repo/web3";
import TurndownService from "turndown";
import ReactMarkdown from "react-markdown";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
  Button,
  Card,
  CardContent,
  CardHeader,
  cn,
  IconLoading,
  Input,
  Label,
  RichTextEditor,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@repo/ui";
import { ArrowLeft, ArrowRight, HelpCircle } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAccount } from "@repo/web3/wagmi";
import { ConnectButton } from "../connect-button";
import {
  CreateProposalProvider,
  CreateProposalStep,
  useCreateProposal,
} from "./create-proposal-provider";

const isTextInvalid = (html: string) => {
  const text = html.replace(/<[^>]*>/g, "").trim();
  return text.length < 100;
};

// Convert HTML to Markdown for preview purposes
const htmlToMarkdown = (html: string): string => {
  const turndownService = new TurndownService({
    headingStyle: "atx", // Use # style headings instead of underline style
    codeBlockStyle: "fenced",
    emDelimiter: "*",
    hr: "---", // Use --- for horizontal rules instead of *
  });

  // Add custom rule for HR elements
  turndownService.addRule("horizontalRule", {
    filter: "hr",
    replacement: function () {
      return "\n\n---\n\n";
    },
  });

  return turndownService.turndown(html);
};

// Convert Markdown to HTML for the editor
const markdownToHtml = (markdown: string): string => {
  // Basic markdown to HTML conversion
  let html = markdown
    // Horizontal rules (must come before other replacements)
    .replace(/^---$/gim, "<hr>")
    .replace(/^\*\*\*$/gim, "<hr>")
    .replace(/^___$/gim, "<hr>")
    // Headers
    .replace(/^### (.*$)/gim, "<h3>$1</h3>")
    .replace(/^## (.*$)/gim, "<h2>$1</h2>")
    .replace(/^# (.*$)/gim, "<h1>$1</h1>")
    // Bold
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    // Italic (but not HR)
    .replace(/(?<!\*)\*(?!\*)(.+?)\*(?!\*)/g, "<em>$1</em>")
    // Links
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    // Line breaks
    .replace(/\n\n/g, "</p><p>")
    .replace(/\n/g, "<br>");

  // Wrap in paragraph tags if needed
  if (!html.startsWith("<")) {
    html = "<p>" + html + "</p>";
  }

  return html;
};

const ProposalDetailsStep = () => {
  const { setStep, newProposal, updateProposal } = useCreateProposal();
  const { proposals, isLoading } = useProposals();

  // Initialize HTML content - convert from Markdown if we have a description
  const [htmlContent, setHtmlContent] = useState(() => {
    if (newProposal.description) {
      // If we have a description, it's in Markdown format, convert to HTML
      return markdownToHtml(newProposal.description);
    }
    return "";
  });

  const [markdownPreview, setMarkdownPreview] = useState(
    newProposal.description || "",
  );

  const isDescriptionInvalid = useMemo(
    () => isTextInvalid(htmlContent),
    [htmlContent],
  );

  // Check if title is unique among existing proposals
  const isTitleUnique = useMemo(() => {
    if (!newProposal.title.trim()) return true; // Empty title is handled by required validation
    return !proposals.some(
      (proposal) =>
        proposal.metadata.title.toLowerCase().trim() ===
        newProposal.title.toLowerCase().trim(),
    );
  }, [newProposal.title, proposals]);

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    updateProposal({
      ...newProposal,
      title: e.target.value,
    });
  };

  const handleDescriptionChange = (content: string) => {
    setHtmlContent(content);

    const markdownContent = htmlToMarkdown(content);

    updateProposal({
      ...newProposal,
      description: markdownContent,
    });

    setMarkdownPreview(markdownContent);
  };

  const scrollToTop = () => {
    window.scrollTo({ top: 0 });
  };

  const handleNextClick = () => {
    setStep(CreateProposalStep.execution);
    scrollToTop();
  };

  const rawProposalDescription = useMemo(() => {
    // For validation, we need to check the length of the text content
    // Since we're storing markdown in newProposal.description, we need to check the HTML content
    return htmlContent.replace(/<[^>]*>/g, "");
  }, [htmlContent]);

  return (
    <div>
      <h2
        className="mb-4 text-lg font-medium md:text-3xl"
        data-testid="proposalDetailsStageLabel"
      >
        Proposal Details
      </h2>
      <p className="text-muted-foreground text-sm">
        Provide crucial information about your proposal. This will be public
        once your proposal goes live.{" "}
      </p>
      <Tabs defaultValue="write">
        <TabsList>
          <TabsTrigger value="write">Write</TabsTrigger>
          <TabsTrigger value="preview">Preview</TabsTrigger>
        </TabsList>
        <TabsContent value="write" className="pt-8">
          <div className="mb-6 flex flex-col gap-1">
            <Label>Title</Label>
            <Input
              placeholder="Start typing..."
              className={`h-14 ${!isTitleUnique ? "border-destructive" : ""}`}
              value={newProposal.title}
              onChange={handleTitleChange}
              data-testid="proposalTitleInput"
              maxLength={100}
            />
            <p
              className={cn(
                "text-destructive mt-1 text-sm opacity-0 transition-opacity",
                !isTitleUnique ? "opacity-100" : "opacity-0",
              )}
              data-testid="titleError"
            >
              A proposal with this title already exists.
            </p>
          </div>
          <div
            className="mb-8 flex flex-col gap-1"
            data-testid="proposalDescriptionInput"
          >
            <Label>Description</Label>
            <RichTextEditor
              value={htmlContent}
              onChange={handleDescriptionChange}
            />

            <p
              className={`text-muted-foreground mt-1 text-sm transition-opacity ${rawProposalDescription.length < 100 ? "opacity-100" : "opacity-0"}`}
            >
              The description must be at least 100 characters long. Write{" "}
              {100 - rawProposalDescription.length} more characters.
            </p>
          </div>
        </TabsContent>
        <TabsContent value="preview" className="pt-8">
          <h2
            className="mb-2 max-w-2xl overflow-hidden text-ellipsis text-2xl font-medium md:mb-4 md:text-5xl"
            data-testid="previewLabel"
            title={newProposal.title}
          >
            {newProposal.title}
          </h2>
          <div className="prose prose-invert">
            <ReactMarkdown>{markdownPreview}</ReactMarkdown>
          </div>
        </TabsContent>
      </Tabs>

      <div className="flex w-full items-center gap-4 md:justify-end">
        <Button
          className="h-10 w-full min-w-[188px] md:ml-auto md:w-fit"
          clipped="sm"
          onClick={handleNextClick}
          disabled={
            (proposals?.length === 0 && isLoading) ||
            !newProposal.title ||
            isDescriptionInvalid ||
            !isTitleUnique
          }
          data-testid="nextButton"
        >
          Next <ArrowRight />
        </Button>
      </div>
    </div>
  );
};

const ExecutionCodeStep = () => {
  const { setStep, newProposal, updateProposal } = useCreateProposal();
  const [validationError, setValidationError] = useState<string | null>(null);

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const validateExecutionCode = (code: string): string | null => {
    // Check if code is empty or only whitespace
    if (!code || code.trim() === "") {
      return "Execution code is required";
    }

    try {
      // Try to parse the JSON
      const parsed = JSON.parse(code);

      // Check if it's an array
      if (!Array.isArray(parsed)) {
        return "Execution code must be a JSON array";
      }

      // Check if array has at least one item
      if (parsed.length === 0) {
        return "Execution code must contain at least one transaction";
      }

      // Validate each transaction object
      for (let i = 0; i < parsed.length; i++) {
        const tx = parsed[i];

        // Check required properties
        if (!tx.address) {
          return `Transaction #${i + 1} is missing the 'address' property`;
        }

        if (typeof tx.value === "undefined") {
          return `Transaction #${i + 1} is missing the 'value' property`;
        }

        if (!tx.data) {
          return `Transaction #${i + 1} is missing the 'data' property`;
        }

        // Check address format (basic check for 0x prefix)
        if (typeof tx.address !== "string" || !tx.address.startsWith("0x")) {
          return `Transaction #${i + 1} has invalid address format. Must be a hex string starting with 0x`;
        }

        // Check data format (basic check for 0x prefix)
        if (typeof tx.data !== "string" || !tx.data.startsWith("0x")) {
          return `Transaction #${i + 1} has invalid data format. Must be a hex string starting with 0x`;
        }
      }

      return null;
    } catch {
      return "Invalid JSON format. Please check your syntax.";
    }
  };

  // Validate initial value on component mount
  useEffect(() => {
    setValidationError(validateExecutionCode(newProposal.code));
  }, [newProposal.code]);

  const handleCodeChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newCode = e.target.value;
    updateProposal({
      ...newProposal,
      code: newCode,
    });

    // Validate the code
    setValidationError(validateExecutionCode(newCode));
  };

  const tooltipContent = (
    <div className="max-w-xs">
      <p className="mb-1 font-medium">Execution Code Requirements:</p>
      <ul className="list-disc space-y-1 pl-4">
        <li>Must be a valid JSON array</li>
        <li>Must contain at least one transaction object</li>
        <li>
          Each transaction must have:
          <ul className="mt-1 list-disc pl-4">
            <li>address: Contract address (0x...)</li>
            <li>value: Number or BigInt</li>
            <li>data: Hex string (0x...)</li>
          </ul>
        </li>
      </ul>
    </div>
  );

  return (
    <div>
      <div className="mb-2 flex items-center gap-2 md:mb-4">
        <h2
          className="text-lg font-medium md:text-3xl"
          data-testid="executionCodeStageLabel"
        >
          Execution Code
        </h2>
        <Tooltip>
          <TooltipTrigger asChild>
            <HelpCircle className="text-muted-foreground h-5 w-5 cursor-help" />
          </TooltipTrigger>
          <TooltipContent side="right" className="w-80">
            {tooltipContent}
          </TooltipContent>
        </Tooltip>
      </div>
      <p className="text-muted-foreground mb-8 text-sm">
        Paste your proposal's execution code in JSON format into the field
        below. If your proposal does not need execution code, simply leave it as
        is.
      </p>
      <div className="mb-4 flex flex-col gap-1">
        <Label>Execution Code</Label>
        <Textarea
          className="max-h-[66vh] min-h-44"
          placeholder="Start typing..."
          value={newProposal.code}
          onChange={handleCodeChange}
          data-testid="executionCodeInput"
        />
      </div>
      <div className="flex flex-col items-center gap-4 md:flex-row-reverse md:justify-between">
        <Button
          className="h-10 w-full md:w-48"
          clipped="default"
          onClick={() => {
            setStep(CreateProposalStep.preview);
            scrollToTop();
          }}
          disabled={!!validationError}
          data-testid="nextButton"
        >
          {newProposal.code && validationError
            ? "Invalid execution code"
            : "Next"}{" "}
          {!validationError && <ArrowRight />}
        </Button>
        <Button
          className="h-10 w-full md:w-48"
          clipped="default"
          variant="abstain"
          onClick={() => {
            setStep(CreateProposalStep.content);
            scrollToTop();
          }}
          data-testid="previousButton"
        >
          <ArrowLeft />
          Previous
        </Button>
      </div>
    </div>
  );
};

const CollapsibleHtmlContent = ({ htmlContent }: { htmlContent: string }) => {
  const [open, setOpen] = useState(false);
  const [showButton, setShowButton] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const checkHeight = () => {
      if (contentRef.current) {
        const scrollHeight = contentRef.current.scrollHeight;
        const shouldShow = scrollHeight > 300; // 300px is the max-height
        setShowButton(shouldShow);
      }
    };

    // Check initially
    checkHeight();

    // Check again after a small delay to ensure content is rendered
    const timer = setTimeout(checkHeight, 100);

    // Also check on window resize
    window.addEventListener("resize", checkHeight);

    return () => {
      clearTimeout(timer);
      window.removeEventListener("resize", checkHeight);
    };
  }, [htmlContent]);

  return (
    <div
      className={cn(
        "prose prose-invert relative min-h-20 w-full",
        open
          ? "max-h-none overflow-visible"
          : "max-h-[300px] overflow-x-hidden overflow-y-visible",
      )}
    >
      <div
        ref={contentRef}
        dangerouslySetInnerHTML={{ __html: htmlContent }}
        data-testid="proposalDetailsContent"
      />
      {showButton && open && (
        <div className="mt-4 flex justify-center">
          <Button
            onClick={() => setOpen(false)}
            variant="text"
            data-testid="seeLess_proposalDetailsButton"
          >
            See less
          </Button>
        </div>
      )}
      {showButton && !open && (
        <div className="to-card absolute inset-x-0 bottom-0 flex justify-center bg-gradient-to-b from-transparent pb-8 pt-16">
          <Button
            onClick={() => setOpen(true)}
            variant="text"
            data-testid="seeAll_proposalDetailsButton"
          >
            See all
          </Button>
        </div>
      )}
    </div>
  );
};

const CollapsibleJsonCode = ({ jsonString }: { jsonString: string }) => {
  const [open, setOpen] = useState(false);
  const [showButton, setShowButton] = useState(false);
  const contentRef = useRef<HTMLPreElement>(null);

  const formatJson = (jsonStr: string) => {
    try {
      const parsed = JSON.parse(jsonStr);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return jsonStr; // Return original if parsing fails
    }
  };

  useEffect(() => {
    const checkHeight = () => {
      if (contentRef.current) {
        const scrollHeight = contentRef.current.scrollHeight;
        const shouldShow = scrollHeight > 400; // 400px is the max-height for code
        setShowButton(shouldShow);
      }
    };

    // Check initially
    checkHeight();

    // Check again after a small delay to ensure content is rendered
    const timer = setTimeout(checkHeight, 100);

    // Also check on window resize
    window.addEventListener("resize", checkHeight);

    return () => {
      clearTimeout(timer);
      window.removeEventListener("resize", checkHeight);
    };
  }, [jsonString]);

  return (
    <div
      className={cn(
        "relative min-h-20",
        open ? "max-h-none overflow-visible" : "max-h-[400px] overflow-hidden",
      )}
    >
      <pre
        ref={contentRef}
        className="border-border text-muted-foreground overflow-x-auto rounded-lg border p-4 text-sm"
      >
        <code data-testid="executionCodeContent">{formatJson(jsonString)}</code>
      </pre>
      {showButton && open && (
        <div className="mt-4 flex justify-center">
          <Button
            onClick={() => setOpen(false)}
            variant="text"
            data-testid="seeLess_executionCodeButton"
          >
            See less
          </Button>
        </div>
      )}
      {showButton && !open && (
        <div className="to-card absolute inset-x-0 bottom-0 flex justify-center bg-gradient-to-b from-transparent pb-8 pt-16">
          <Button
            onClick={() => setOpen(true)}
            variant="text"
            data-testid="seeAll_executionCodeButton"
          >
            See all
          </Button>
        </div>
      )}
    </div>
  );
};

const ReviewStep = () => {
  const { setStep, newProposal, submitProposal } = useCreateProposal();
  const [htmlContent, setHtmlContent] = useState("");

  // When the component mounts or newProposal changes, update the HTML content
  useEffect(() => {
    // Convert markdown to HTML for display
    const previewHtml = markdownToHtml(newProposal.description);
    setHtmlContent(previewHtml);
  }, [newProposal.description]);

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div>
      <h2
        className="mb-2 max-w-2xl overflow-hidden text-ellipsis text-lg font-medium md:mb-4 md:text-3xl"
        data-testid="reviewStageLabel"
        title={newProposal.title}
      >
        {newProposal.title}
      </h2>
      <p className="text-muted-foreground mb-8 text-sm">
        You're successfully finished all the steps. Now, take a moment to go
        over your proposal and then submit it.
      </p>
      <hr className="border-border mb-8" />
      <CollapsibleHtmlContent htmlContent={htmlContent} />
      <hr className="border-border my-8" />
      <h2 className="mb-2 text-lg font-medium md:mb-4 md:text-3xl">
        Execution Code
      </h2>
      <CollapsibleJsonCode jsonString={newProposal.code} />
      <div className="mt-4 flex flex-col items-center gap-4 md:flex-row-reverse md:justify-between">
        <Button
          className="h-10 w-full md:w-auto"
          clipped="default"
          onClick={() => {
            submitProposal();
            scrollToTop();
          }}
          data-testid="createProposalButton"
        >
          Create Proposal <ArrowRight />
        </Button>
        <Button
          className="h-10 w-full md:w-auto"
          clipped="default"
          variant="abstain"
          onClick={() => {
            setStep(CreateProposalStep.execution);
            scrollToTop();
          }}
          data-testid="previousButton"
        >
          <ArrowLeft />
          Previous
        </Button>
      </div>
    </div>
  );
};

function CreateProposalSteps() {
  const { step } = useCreateProposal();
  const { isConnected } = useAccount();
  const { veMentoBalance, mentoBalance, isBalanceLoading } = useTokens();
  const { proposalThreshold, isLoadingProposalThreshold } =
    useProposalThreshold();

  const [notEnough, setNotEnough] = useState(false);

  useEffect(() => {
    if (isConnected && proposalThreshold && veMentoBalance && mentoBalance) {
      if (veMentoBalance.value < proposalThreshold) {
        setNotEnough(true);
      } else {
        setNotEnough(false);
      }
    }
  }, [
    isConnected,
    veMentoBalance.value,
    proposalThreshold,
    mentoBalance.value,
  ]);

  if (isBalanceLoading || isLoadingProposalThreshold) {
    return (
      <div className="flex h-full min-h-[188px] items-center justify-center">
        <IconLoading />
      </div>
    );
  }

  if (notEnough) {
    return (
      <>
        <h2 className="mb-4 text-lg font-medium md:text-3xl">
          Not enough veMENTO
        </h2>
        <p className="text-muted-foreground mb-8 text-sm">
          You have{" "}
          <span className="text-foreground">
            {formatUnitsWithThousandSeparators(
              mentoBalance.value,
              mentoBalance.decimals,
              2,
            )}{" "}
            MENTO
          </span>{" "}
          &{" "}
          <span className="text-foreground">
            {formatUnitsWithThousandSeparators(
              veMentoBalance.value,
              veMentoBalance.decimals,
              4,
            )}{" "}
            veMENTO
          </span>
          <br />
          <br />
          To create a new governance proposal, you should have{" "}
          <span className="text-foreground">
            {formatUnitsWithThousandSeparators(proposalThreshold, 18, 4)}{" "}
            veMENTO
          </span>{" "}
          in your account.
          <br />
        </p>
        <Button className="h-10 w-full" clipped="default" asChild>
          <Link href="/voting-power">Lock MENTO</Link>
        </Button>
      </>
    );
  }

  if (!isConnected) {
    return (
      <>
        <h2 className="mb-4 text-lg font-medium md:text-3xl">Connect Wallet</h2>
        <p className="text-muted-foreground mb-8 text-sm">
          Connect your wallet to create new proposal.
        </p>
        <ConnectButton fullwidth size="lg" />
      </>
    );
  }

  return (
    <>
      {step === CreateProposalStep.content && <ProposalDetailsStep />}
      {step === CreateProposalStep.execution && <ExecutionCodeStep />}
      {step === CreateProposalStep.preview && <ReviewStep />}
    </>
  );
}

function ProposalBreadcrumb() {
  const { step, setStep } = useCreateProposal();
  const { isConnected } = useAccount();

  return (
    <div className="flex w-full items-center justify-between">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="/">Home</BreadcrumbLink>
          </BreadcrumbItem>

          <BreadcrumbSeparator />

          <BreadcrumbItem>
            <BreadcrumbLink
              onClick={() => setStep(CreateProposalStep.content)}
              className={cn(
                "cursor-pointer",
                !isConnected && "pointer-events-none opacity-75",
                step === CreateProposalStep.content && "text-white opacity-100",
              )}
            >
              Proposal Details
            </BreadcrumbLink>
          </BreadcrumbItem>

          <BreadcrumbSeparator />

          <BreadcrumbItem>
            <BreadcrumbLink
              onClick={() => setStep(CreateProposalStep.execution)}
              className={cn(
                "cursor-pointer",
                step < CreateProposalStep.execution &&
                  "pointer-events-none opacity-75",
                step === CreateProposalStep.execution &&
                  "text-white opacity-100",
              )}
            >
              Execution Code
            </BreadcrumbLink>
          </BreadcrumbItem>

          <BreadcrumbSeparator />

          <BreadcrumbItem>
            <BreadcrumbLink
              onClick={() => setStep(CreateProposalStep.preview)}
              className={cn(
                "cursor-pointer",
                step < CreateProposalStep.preview &&
                  "pointer-events-none opacity-75",
                step === CreateProposalStep.preview && "text-white opacity-100",
              )}
            >
              Review
            </BreadcrumbLink>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      <div className="text-muted-foreground flex items-center gap-4 text-sm">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "bg-muted-foreground/50 block h-1 w-1",
              isConnected &&
                step === CreateProposalStep.content &&
                "bg-primary",
            )}
          />
          <span
            className={cn(
              "bg-muted-foreground/50 block h-1 w-1",
              step === CreateProposalStep.execution && "bg-primary",
            )}
          />
          <span
            className={cn(
              "bg-muted-foreground/50 block h-1 w-1",
              step === CreateProposalStep.preview && "bg-primary",
            )}
          />
        </div>
        <div className="flex items-center gap-2">
          <span>Step</span>
          <span
            className={cn(
              "text-foreground",
              !isConnected && "text-muted-foreground",
            )}
          >
            {step}/3
          </span>
        </div>
      </div>
    </div>
  );
}

export default function CreateProposalForm() {
  return (
    <CreateProposalProvider>
      <Card className="border-border pt-0">
        <CardHeader className="bg-card-header flex h-16 items-center">
          <ProposalBreadcrumb />
        </CardHeader>
        <CardContent>
          <CreateProposalSteps />
        </CardContent>
      </Card>
    </CreateProposalProvider>
  );
}
