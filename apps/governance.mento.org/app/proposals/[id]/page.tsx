import {
  Button,
  ProposalStatus,
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  ProposalCard,
  ProposalCardHeader,
  ProposalCardBody,
  ProposalCardFooter,
  IconTimer,
  IconCheckCircle,
  IconThunder,
} from "@repo/ui";
import { Copy } from "lucide-react";
import ReactMarkdown from "react-markdown";
import gfm from "remark-gfm";

const markdown =
  "## TL;DR\n\nThis proposal removes the temporary permissions granted to the Mento Labs multisig over the Locking contract, which were established during Celo's L2 transition through MGP03. This also marks the first governance proposal after the successful L2 transition and serves as a confirmation of the governance system's functionality.\n\n### Summary\n\nFollowing the successful transition of Celo to L2 and the subsequent verification of the Locking contract's proper functionality with the new block times, it is time to remove the temporary administrative rights granted to the Mento Labs multisig through MGP03. All necessary parameter adjustments have been completed and tested, confirming the contract's compatibility with the new L2 environment.\n\nThe Locking contract has been operating as expected since the L2 transition, with locks functioning correctly under the new 1-second block time. Our testing has verified that:\n\n- Existing locks maintained their integrity during the transition\n- New locks are being created successfully\n- The adjusted parameters are working as intended with the new block time\n\nThis proposal represents a milestone as it will be the first governance proposal executed after the L2 transition, providing a validation of the governance system's functionality in the new environment.\n\n### Transaction Details\n\nThis proposal consists of one transaction:\n\n**TX#0:** call the `setMentoLabsMultisig(address _mentoLabsMultisig)` function with a zero address\n\n- Target: Locking Proxy contract\n- Function: `setMentoLabsMultisig(address)`\n- Parameter: `0x0000000000000000000000000000000000000000`\n\n**Relevant Addresses for verification**\n\n- Locking Proxy\n  - [_0x001Bb66636dCd149A1A2bA8C50E408BdDd80279C_](https://celoscan.io/address/0x001Bb66636dCd149A1A2bA8C50E408BdDd80279C)\n\n### Expected Outcome\n\nUpon successful execution of this proposal:\n\n1. The Mento Labs multisig will no longer have administrative rights over the Locking contract\n2. The governance system will be confirmed to be functioning correctly in the post-L2 environment\n\nThis completes the temporary administrative arrangements that were put in place for the L2 transition and returns control to the governance system.\n";

export default async function ProposalPage() {
  return (
    <>
      <main className="md:px-22 xl:px-22 relative flex w-full flex-col items-start justify-start gap-12 px-4 py-8 md:py-16 lg:flex-row lg:gap-20">
        <div className="w-full flex-grow">
          <div className="mb-6">
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem>
                  <BreadcrumbLink href="/">Home</BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbPage>1</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </div>

          <div className="mb-8 flex flex-col gap-6 md:mb-16">
            <ProposalStatus variant="active" />
            <h1 className="max-w-[26ch] text-3xl font-medium md:text-6xl">
              MGP-6: Remove Mento Labs multisig on Locking contract
            </h1>
            <div className="flex flex-wrap items-center gap-2 md:gap-8">
              <div className="flex items-center gap-2">
                <span className="bg-primary h-4 w-4 rounded-full" />
                <span className="text-muted-foreground text-sm">
                  by 0x3490...8A4B
                </span>
                <Button
                  variant="ghost"
                  size="xs"
                  className="text-secondary-active h-4 w-4"
                >
                  <Copy />
                </Button>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground text-sm">
                  Proposed on:
                </span>
                <span className="text-sm">Sep 15th, 2023</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground text-sm">
                  Voting deadline:
                </span>
                <span className="text-sm">Sep 30th, 2023</span>
              </div>
            </div>
          </div>
          <div className="mb-8 md:mb-16">
            <ProposalCard>
              <ProposalCardHeader variant={"highlighted"}>
                <div className="flex w-full flex-col items-center justify-start gap-4 lg:flex-row">
                  <div className="flex flex-row items-center justify-start gap-2">
                    <span className="flex flex-row items-center gap-2 text-sm">
                      <IconTimer />
                      Time left
                    </span>
                    <span className="text-muted-foreground text-sm">
                      72 : 24 : 13
                    </span>
                  </div>
                  <div className="flex flex-row items-center justify-start gap-2">
                    <span className="flex flex-row items-center gap-2 text-sm">
                      <IconCheckCircle />
                      Quorum reached
                    </span>
                    <span className="text-muted-foreground text-sm">
                      770K of 999K
                    </span>
                  </div>
                  <div className="flex flex-row items-center justify-start gap-2 lg:ml-auto">
                    <span className="text-muted-foreground text-sm">
                      Voting Power:
                    </span>
                    <span className="flex flex-row items-center gap-2 text-sm">
                      <IconThunder /> 500 000 veMENTO
                    </span>
                  </div>
                </div>
              </ProposalCardHeader>
              <ProposalCardBody>
                <div className="lg:y-8 flex w-full flex-col gap-4 px-4 py-6 lg:grid lg:grid-cols-3 lg:gap-8 lg:px-8">
                  <Button clipped="sm" size="md" variant="approve">
                    Approve Proposal
                  </Button>
                  <Button clipped="sm" size="md" variant="abstain">
                    Abstain
                  </Button>
                  <Button clipped="sm" size="md" variant="reject">
                    Reject Proposal
                  </Button>
                </div>
              </ProposalCardBody>
            </ProposalCard>
          </div>
          <div className="prose prose-invert max-w-none">
            <ReactMarkdown remarkPlugins={[gfm]}>{markdown}</ReactMarkdown>
          </div>
        </div>
        <div className="w-full max-w-xs"></div>
      </main>

      <section className="md:px-22 relative w-full px-4 py-8 before:absolute before:left-1/2 before:top-0 before:-z-10 before:h-20 before:w-screen before:-translate-x-1/2 before:bg-gradient-to-b before:from-[#15111B] before:to-[#070010] md:py-16">
        <h2 className="mb-6 text-2xl">Explore Other Proposals</h2>
        <div className="flex flex-col gap-2 lg:grid lg:grid-cols-3 lg:gap-2">
          <div className="bg-card flex flex-col items-start justify-start gap-4 p-4">
            <ProposalStatus variant="active" />
            <h2>MGP-5: Update voting period ahead of L2 transition</h2>
            <div className="text-muted-foreground text-sm">Feb 02, 2025</div>
          </div>

          <div className="bg-card flex flex-col items-start justify-start gap-4 p-4">
            <ProposalStatus variant="active" />
            <h2>MGP-5: Update voting period ahead of L2 transition</h2>
            <div className="text-muted-foreground text-sm">Feb 02, 2025</div>
          </div>

          <div className="bg-card flex flex-col items-start justify-start gap-4 p-4">
            <ProposalStatus variant="active" />
            <h2>MGP-5: Update voting period ahead of L2 transition</h2>
            <div className="text-muted-foreground text-sm">Feb 02, 2025</div>
          </div>
        </div>
      </section>
    </>
  );
}
