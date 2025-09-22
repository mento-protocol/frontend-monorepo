"use client";
import { Card, CardContent, CardHeader, CardTitle } from "@repo/ui";
import { useMemo } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

function decodeHtmlEntities(text: string): string {
  const textArea = document.createElement("textarea");
  textArea.innerHTML = text;
  return textArea.value;
}

interface ProposalDescriptionProps {
  description?: string;
}

export const ProposalDescription = ({
  description,
}: ProposalDescriptionProps) => {
  const descriptionType = useMemo(() => {
    return description?.match(/^<\w+>|<\/\w+>$/) ? "html" : "text";
  }, [description]);

  return (
    <Card className="border-border mt-4">
      <CardHeader>
        <CardTitle className="text-2xl">Proposal Description</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="prose prose-invert">
          {description ? (
            descriptionType === "html" ? (
              <div
                dangerouslySetInnerHTML={{
                  __html: decodeHtmlEntities(description),
                }}
                data-testid="proposalDescriptionLabel"
              />
            ) : (
              <div data-testid="proposalDescriptionLabel">
                <Markdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    a: (props) => (
                      <a
                        {...props}
                        href={
                          props.href?.includes("https")
                            ? props.href
                            : `https://${props.href?.replace("http://", "")}`
                        }
                        target="_blank"
                        rel="noopener noreferrer"
                      />
                    ),
                  }}
                >
                  {description}
                </Markdown>
              </div>
            )
          ) : (
            <p>No description available</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
