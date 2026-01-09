import { memo, useMemo, useState } from "react";

interface Token {
  address: string;
  symbol: string;
  name: string;
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
      <div className="h-5 w-5 text-xs grid aspect-square place-content-center rounded-full bg-muted-foreground">
        ?
      </div>
    );
  }

  const imgSrc = `/tokens/${token.symbol}.svg`;

  if (imgSrc && !imgError) {
    return (
      <img
        src={imgSrc}
        alt=""
        width={size}
        height={size}
        onError={() => setImgError(true)}
        className={className}
      />
    );
  }

  return (
    <div
      className="flex items-center justify-center bg-background"
      style={{ width: size, height: size }}
    >
      <div className="font-semibold text-foreground">{symbol}</div>
    </div>
  );
}

export const TokenIcon = memo(TokenIconBase);
