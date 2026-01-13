import { LockList } from "@/components/lock-list";
import { VoteTitle } from "@/components/voting/vote-title";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@repo/ui";
import VotingPowerForm from "../components/voting-power-form";

export default function VotingPowerPage() {
  return (
    <main className="md:px-22 px-4 py-8 md:py-16 relative w-full">
      <Breadcrumb className="mb-6">
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="/">Home</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Your voting power</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      <VoteTitle />
      <VotingPowerForm />
      <LockList />
    </main>
  );
}
