import NewSwapForm from "./NewSwapForm";

export function NewSwapFormCard() {
  return (
    <>
      <div className="bg-card flex flex-col space-y-6 p-6">
        <h2>Swap</h2>
        <div>
          <NewSwapForm />
        </div>
      </div>
    </>
  );
}
