"use client";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  Button,
  Card,
  CardContent,
  CardHeader,
  cn,
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
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import gfm from "remark-gfm";
import { useAccount } from "wagmi";
import { ConnectButton } from "../connect-button";
import {
  CreateProposalProvider,
  CreateProposalStep,
  useCreateProposal,
} from "./create-proposal-provider";

// Sample markdown for preview
const sampleMarkdown =
  "## TL;DR\n\nThis proposal removes the temporary permissions granted to the Mento Labs multisig over the Locking contract, which were established during Celo's L2 transition through MGP03. This also marks the first governance proposal after the successful L2 transition and serves as a confirmation of the governance system's functionality.\n\n### Summary\n\nFollowing the successful transition of Celo to L2 and the subsequent verification of the Locking contract's proper functionality with the new block times, it is time to remove the temporary administrative rights granted to the Mento Labs multisig through MGP03. All necessary parameter adjustments have been completed and tested, confirming the contract's compatibility with the new L2 environment.\n\n\n### Transaction Details\n\nThis proposal consists of one transaction:\n\n**TX#0:** call the `setMentoLabsMultisig(address _mentoLabsMultisig)` function with a zero address\n\n- Target: Locking Proxy contract\n- Function: `setMentoLabsMultisig(address)`\n- Parameter: `0x0000000000000000000000000000000000000000`\n\n**Relevant Addresses for verification**\n\n- Locking Proxy\n  - [_0x001Bb66636dCd149A1A2bA8C50E408BdDd80279C_](https://celoscan.io/address/0x001Bb66636dCd149A1A2bA8C50E408BdDd80279C)\n";

const ProposalDetailsStep = () => {
  const { setStep, newProposal, updateProposal } = useCreateProposal();
  const [previewContent, setPreviewContent] = useState(
    newProposal.description || sampleMarkdown,
  );

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    updateProposal({
      ...newProposal,
      title: e.target.value,
    });
  };

  const handleDescriptionChange = (content: string) => {
    updateProposal({
      ...newProposal,
      description: content,
    });
    setPreviewContent(content || sampleMarkdown);
  };

  const scrollToTop = () => {
    window.scrollTo({ top: 0 });
  };

  const handleNextClick = () => {
    setStep(CreateProposalStep.execution);
    scrollToTop();
  };

  return (
    <div>
      <h2 className="mb-4 text-lg font-medium md:text-3xl">Proposal Details</h2>
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
          <div className="mb-8 flex flex-col gap-1">
            <Label>Title</Label>
            <Input
              placeholder="Start typing..."
              className="h-14"
              value={newProposal.title}
              onChange={handleTitleChange}
            />
          </div>
          <div className="mb-8 flex flex-col gap-1">
            <Label>Description</Label>
            <RichTextEditor
              value={newProposal.description}
              onChange={handleDescriptionChange}
            />
          </div>
          <div className="flex w-full items-center gap-4 md:justify-end">
            <Button
              className="h-10 w-full min-w-[188px] md:ml-auto md:w-fit"
              clipped="sm"
              onClick={handleNextClick}
            >
              Next <ArrowRight />
            </Button>
          </div>
        </TabsContent>
        <TabsContent value="preview" className="pt-8">
          <div className="prose prose-invert">
            <ReactMarkdown remarkPlugins={[gfm]}>
              {previewContent}
            </ReactMarkdown>
          </div>
        </TabsContent>
      </Tabs>
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

      return null; // No validation errors
    } catch {
      return "Invalid JSON format";
    }
  };

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
        <h2 className="text-lg font-medium md:text-3xl">Execution Code</h2>
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
        Paste your governance proposal's execution code in the JSON format on
        the field below.
      </p>
      <div className="mb-4 flex flex-col gap-1">
        <Label>Execution Code</Label>
        <Textarea
          className="h-screen"
          rows={32}
          placeholder="Start typing..."
          value={newProposal.code}
          onChange={handleCodeChange}
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
          disabled={!newProposal.code || !!validationError}
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

  return (
    <div
      className={cn(
        "prose prose-invert relative min-h-20",
        open ? "h-full min-h-48" : "max-h-[400px] overflow-hidden",
      )}
    >
      <div dangerouslySetInnerHTML={{ __html: htmlContent }} />
      <div className="to-card absolute bottom-0 right-0 flex w-full items-center justify-center bg-gradient-to-b from-transparent pb-8 pt-16">
        <Button onClick={() => setOpen(!open)} variant="text">
          {open ? "See less" : "See all"}
        </Button>
      </div>
    </div>
  );
};

const CollapsibleJsonCode = ({ jsonString }: { jsonString: string }) => {
  const [open, setOpen] = useState(false);

  const formatJson = (jsonStr: string) => {
    try {
      const parsed = JSON.parse(jsonStr);
      return JSON.stringify(parsed, null, 2);
    } catch (error) {
      return jsonStr; // Return original if parsing fails
    }
  };

  return (
    <div
      className={cn(
        "relative min-h-20",
        open ? "h-full min-h-60" : "max-h-[400px] overflow-hidden",
      )}
    >
      <pre className="border-border text-muted-foreground overflow-x-auto rounded-lg border p-4 text-sm">
        <code>{formatJson(jsonString)}</code>
      </pre>
      <div className="to-card absolute bottom-0 right-0 flex w-full items-center justify-center bg-gradient-to-b from-transparent pb-8 pt-16">
        <Button onClick={() => setOpen(!open)} variant="text">
          {open ? "See less" : "See all"}
        </Button>
      </div>
    </div>
  );
};

const ReviewStep = () => {
  const { setStep, newProposal, submitProposal } = useCreateProposal();

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  console.log(newProposal);
  return (
    <div>
      <h2 className="mb-2 text-lg font-medium md:mb-4 md:text-3xl">Review</h2>
      <p className="text-muted-foreground mb-8 text-sm">
        You're successfully finished all the steps. Now, take a moment to go
        over your proposal and then submit it.
      </p>
      <hr className="border-border mb-8" />
      <CollapsibleHtmlContent
        htmlContent={newProposal.description || sampleMarkdown}
      />
      <hr className="border-border my-8" />
      <h2 className="mb-2 text-lg font-medium md:mb-4 md:text-3xl">
        Execution Code
      </h2>
      <CollapsibleJsonCode jsonString={newProposal.code} />
      <div className="flex flex-col items-center gap-4 md:flex-row-reverse md:justify-between">
        <Button
          className="h-10 w-full md:w-auto"
          clipped="default"
          onClick={() => {
            submitProposal();
            scrollToTop();
          }}
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
            <BreadcrumbLink
              onClick={() => setStep(CreateProposalStep.content)}
              className={cn(
                "cursor-pointer",
                !isConnected && "pointer-events-none opacity-75",
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
