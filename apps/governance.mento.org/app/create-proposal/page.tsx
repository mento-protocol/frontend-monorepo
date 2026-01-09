import CreateProposalForm from "../components/create-proposal/create-proposal-form";

export default function CreateProposalPage() {
  return (
    <main className="md:px-22 px-4 py-8 md:py-16 relative w-full">
      <h1 className="mb-8 font-medium md:mb-16 md:text-center md:text-6xl w-full text-3xl">
        Create New Proposal
      </h1>
      <CreateProposalForm />
    </main>
  );
}
