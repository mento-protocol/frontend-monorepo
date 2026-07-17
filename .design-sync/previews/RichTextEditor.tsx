import { RichTextEditor } from "@mento-protocol/ui";

export const ProposalBody = () => (
  <div style={{ width: 540 }}>
    <RichTextEditor
      value={
        "<h2>Increase the stability pool cap</h2><p>This proposal raises the USDm stability pool cap to <strong>10M</strong> to accommodate growing demand.</p><ul><li>Higher deposit ceiling</li><li>No change to fees</li></ul>"
      }
      onChange={() => {}}
    />
  </div>
);
