"use client";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@repo/ui";
import { ParticipantList } from "./ParticipantList";

interface ParticipantsProps {
  proposal: {
    votes: {
      for: {
        participants: unknown[];
      };
      against: {
        participants: unknown[];
      };
      abstain: {
        participants: unknown[];
      };
    };
  };
}

export const Participants = ({ proposal }: ParticipantsProps) => {
  return (
    <Card className="bord max-h-[420px] w-full gap-3 overflow-hidden border-none">
      <CardHeader>
        <CardTitle className="text-2xl">Participants</CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="for" className="max-h-[330px] overflow-auto">
          <TabsList>
            <TabsTrigger value="for" data-testid="participantsTabButton_yes">
              Yes
            </TabsTrigger>
            <TabsTrigger value="against" data-testid="participantsTabButton_no">
              No
            </TabsTrigger>
            <TabsTrigger
              value="abstain"
              data-testid="participantsTabButton_abstain"
            >
              Abstain
            </TabsTrigger>
          </TabsList>

          <TabsContent value="for" className="max-h-[330px] overflow-auto">
            <ParticipantList participants={proposal.votes.for.participants} />
          </TabsContent>

          <TabsContent value="against" className="max-h-[330px] overflow-auto">
            <ParticipantList
              participants={proposal.votes.against.participants}
            />
          </TabsContent>

          <TabsContent value="abstain" className="max-h-[330px] overflow-auto">
            <ParticipantList
              participants={proposal.votes.abstain.participants}
            />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
};
