// Server Component (no "use client" directive)

// This would typically fetch data from a database or API
async function getData() {
  // Simulate server-side data fetching with a delay
  await new Promise((resolve) => setTimeout(resolve, 100));

  return {
    title: "Welcome to the App",
    description: "This content was rendered on the server.",
  };
}

export async function WelcomeMessage() {
  // This data fetching happens on the server
  const data = await getData();

  return (
    <div className="mb-8 text-center">
      <h1 className="mb-2 text-4xl font-bold">{data.title}</h1>
      <p className="text-gray-600">{data.description}</p>
    </div>
  );
}
