import CreateProposalForm from "../components/create-proposal-form";

export default function CreateProposalPage() {
  return (
    <main className="md:px-22 relative w-full px-4 py-8 md:py-16">
      <h1 className="mb-8 text-3xl font-medium md:text-6xl">
        Create New Proposal
      </h1>
      <CreateProposalForm />
    </main>
  );
}
