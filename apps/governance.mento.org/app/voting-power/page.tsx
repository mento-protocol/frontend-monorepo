import VotingPowerForm from "../components/voting-power-form";

export default function CreateProposalPage() {
  return (
    <main className="md:px-22 relative w-full px-4 pt-8 md:pt-16">
      <h1 className="mb-8 text-3xl font-medium md:mb-16 md:text-6xl">
        Your voting power
      </h1>
      <VotingPowerForm />
    </main>
  );
}
