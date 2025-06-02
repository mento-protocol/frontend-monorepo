import { memo, useMemo, useState } from "react";

interface Token {
  id: string;
  symbol: string;
  name: string;
  color: string;
  decimals: number;
}

interface Props {
  token?: Token | null;
  className?: string;
  size?: number;
}

function TokenIconBase({ token, className, size = 20 }: Props) {
  const [imgError, setImgError] = useState(false);

  const symbol = useMemo(() => {
    if (!token) {
      return "";
    }

    if (token.symbol[0] && token.symbol[1]) {
      return token.symbol[0].toUpperCase() + token.symbol[1].toUpperCase();
    }

    return "";
  }, [token]);

  if (!token) {
    return (
      <div className="bg-background flex h-10 w-10 items-center justify-center" />
    );
  }

  const imgSrc = `/tokens/${token.id}.svg`;

  if (imgSrc && !imgError) {
    return (
      <img
        src={imgSrc}
        alt=""
        width={size}
        height={size}
        onError={() => setImgError(true)}
      />
    );
  }

  return (
    <div className="bg-background flex h-10 w-10 items-center justify-center">
      <div className="text-foreground font-semibold">{symbol}</div>
    </div>
  );
}

export const TokenIcon = memo(TokenIconBase);
