"use client";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  Input,
  Label,
  RichTextEditor,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@repo/ui";
import { ArrowRight } from "lucide-react";
import { useState } from "react";

const steps = ["Proposal Details", "Execution Code", "Review"];
type Step = (typeof steps)[number];

const ProposalDetailsStep = () => {
  return (
    <div>
      <h2 className="mb-4 text-lg font-medium md:text-2xl">Proposal Details</h2>
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
          <Button className="h-10 w-full" clipped="sm">
            Next <ArrowRight />
          </Button>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default function CreateProposalForm() {
  const [connected, setConnected] = useState(true);
  const [step, setStep] = useState<Step>(steps[0]);

  return (
    <Card className="border-border">
      <CardHeader className="bg-inn"></CardHeader>
      <CardContent>
        {!connected && (
          <>
            <h2 className="text-lg font-medium md:text-2xl">Connect Wallet</h2>
            <p className="text-muted-foreground text-sm">
              Connect your wallet to create new proposal.
            </p>
          </>
        )}
        <ProposalDetailsStep />
      </CardContent>
    </Card>
  );
}
