"use client";
import {
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
} from "@repo/ui";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import gfm from "remark-gfm";
import { atom, useAtom, useSetAtom } from "jotai";

const steps = ["Proposal Details", "Execution Code", "Review"];
type Step = (typeof steps)[number];

const stepAtom = atom<Step>(steps[0]);

const markdown =
  "## TL;DR\n\nThis proposal removes the temporary permissions granted to the Mento Labs multisig over the Locking contract, which were established during Celo's L2 transition through MGP03. This also marks the first governance proposal after the successful L2 transition and serves as a confirmation of the governance system's functionality.\n\n### Summary\n\nFollowing the successful transition of Celo to L2 and the subsequent verification of the Locking contract's proper functionality with the new block times, it is time to remove the temporary administrative rights granted to the Mento Labs multisig through MGP03. All necessary parameter adjustments have been completed and tested, confirming the contract's compatibility with the new L2 environment.\n\n\n### Transaction Details\n\nThis proposal consists of one transaction:\n\n**TX#0:** call the `setMentoLabsMultisig(address _mentoLabsMultisig)` function with a zero address\n\n- Target: Locking Proxy contract\n- Function: `setMentoLabsMultisig(address)`\n- Parameter: `0x0000000000000000000000000000000000000000`\n\n**Relevant Addresses for verification**\n\n- Locking Proxy\n  - [_0x001Bb66636dCd149A1A2bA8C50E408BdDd80279C_](https://celoscan.io/address/0x001Bb66636dCd149A1A2bA8C50E408BdDd80279C)\n";

const ProposalDetailsStep = () => {
  const setStep = useSetAtom(stepAtom);

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
            <Input placeholder="Start typing..." className="h-14" />
          </div>
          <div className="mb-8 flex flex-col gap-1">
            <Label>Description</Label>
            <RichTextEditor />
          </div>
          <div className="flex w-full items-center gap-4 md:justify-end">
            <Button
              className="h-10 w-full min-w-[188px] md:ml-auto md:w-fit"
              clipped="sm"
              onClick={() => setStep("Execution Code")}
            >
              Next <ArrowRight />
            </Button>
          </div>
        </TabsContent>
        <TabsContent value="preview" className="pt-8">
          <div className="prose prose-invert">
            <ReactMarkdown remarkPlugins={[gfm]}>{markdown}</ReactMarkdown>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};

const ExecutionCodeStep = () => {
  const setStep = useSetAtom(stepAtom);
  return (
    <div>
      <h2 className="mb-2 text-lg font-medium md:mb-4 md:text-3xl">
        Execution Code
      </h2>
      <p className="text-muted-foreground mb-8 text-sm">
        Paste your governance proposal’s execution code in the json format on
        the field below.
      </p>
      <div className="mb-4 flex flex-col gap-1">
        <Label>Execution Code</Label>
        <Textarea
          className="h-screen"
          rows={32}
          placeholder="Start typing..."
        />
      </div>
      <div className="flex flex-col items-center gap-4 md:flex-row md:justify-between">
        <Button
          className="h-10 w-full"
          clipped="default"
          onClick={() => setStep("Review")}
        >
          Next <ArrowRight />
        </Button>
        <Button
          className="h-10 w-full"
          clipped="default"
          variant="abstain"
          onClick={() => setStep("Proposal Details")}
        >
          <ArrowLeft />
          Previous
        </Button>
      </div>
    </div>
  );
};

const CollapsibleMarkdown = ({ markdown }: { markdown: string }) => {
  const [open, setOpen] = useState(false);

  return (
    <div
      className={cn(
        "prose prose-invert relative",
        open ? "h-full" : "max-h-[400px] overflow-hidden",
      )}
    >
      <ReactMarkdown remarkPlugins={[gfm]}>{markdown}</ReactMarkdown>
      <div className="to-card absolute bottom-0 right-0 flex w-full items-center justify-center bg-gradient-to-b from-transparent pb-8 pt-16">
        <Button onClick={() => setOpen(!open)} variant="text">
          {open ? "See less" : "See all"}
        </Button>
      </div>
    </div>
  );
};

const ReviewStep = () => {
  const setStep = useSetAtom(stepAtom);
  return (
    <div>
      <h2 className="mb-2 text-lg font-medium md:mb-4 md:text-3xl">Review</h2>
      <p className="text-muted-foreground mb-8 text-sm">
        You’re successfully finished all the steps. Now, take a moment to go
        over your proposal and then submit it.
      </p>
      <hr className="border-border mb-8" />
      <CollapsibleMarkdown markdown={markdown} />
      <hr className="border-border my-8" />
      <h2 className="mb-2 text-lg font-medium md:mb-4 md:text-3xl">
        Execution Code
      </h2>
      <CollapsibleMarkdown markdown={markdown} />
      <div className="flex flex-col items-center gap-4 md:flex-row-reverse md:justify-between">
        <Button
          className="h-10 w-full md:w-auto"
          clipped="default"
          onClick={() => setStep("Execution Code")}
        >
          Create Proposal <ArrowRight />
        </Button>
        <Button
          className="h-10 w-full md:w-auto"
          clipped="default"
          variant="abstain"
          onClick={() => setStep("Execution Code")}
        >
          <ArrowLeft />
          Previous
        </Button>
      </div>
    </div>
  );
};

export default function CreateProposalForm() {
  const [connected] = useState(true);
  const [step] = useAtom(stepAtom);

  return (
    <Card className="border-border pt-0">
      <CardHeader className="bg-card-header h-16"></CardHeader>
      <CardContent>
        {!connected && (
          <>
            <h2 className="text-lg font-medium md:text-3xl">Connect Wallet</h2>
            <p className="text-muted-foreground text-sm">
              Connect your wallet to create new proposal.
            </p>
          </>
        )}
        {step === "Proposal Details" && <ProposalDetailsStep />}
        {step === "Execution Code" && <ExecutionCodeStep />}
        {step === "Review" && <ReviewStep />}
      </CardContent>
    </Card>
  );
}
