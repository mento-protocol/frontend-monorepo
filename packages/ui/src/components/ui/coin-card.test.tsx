import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  CoinCard,
  CoinCardFooter,
  CoinCardHeader,
  CoinCardHeaderGroup,
  CoinCardLogo,
  CoinCardName,
  CoinCardSupply,
  CoinCardSymbol,
} from "@/components/ui/coin-card.js";

describe("CoinCard", () => {
  it("renders a composed coin card unchanged", () => {
    const { container } = render(
      <CoinCard>
        <CoinCardHeader>
          <CoinCardLogo />
          <CoinCardHeaderGroup>
            <CoinCardSymbol>USDm</CoinCardSymbol>
            <CoinCardName>Mento US Dollar</CoinCardName>
          </CoinCardHeaderGroup>
        </CoinCardHeader>
        <CoinCardFooter>
          <CoinCardSupply>1,000,000</CoinCardSupply>
        </CoinCardFooter>
      </CoinCard>,
    );
    expect(container.firstChild).toMatchSnapshot();
  });
});
