import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@repo/ui";
import VotingPowerForm from "../components/voting-power-form";

export default function CreateProposalPage() {
  return (
    <main className="md:px-22 relative w-full px-4 py-8 md:py-16">
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
      <h1 className="mb-8 text-3xl font-medium md:mb-16 md:text-6xl">
        Your voting power
      </h1>
      <VotingPowerForm />
    </main>
  );
}
