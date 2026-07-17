import {
  LockCard,
  LockCardHeader,
  LockCardHeaderGroup,
  LockCardAmount,
  LockCardName,
  LockCardBadge,
  LockCardBody,
  LockCardRow,
  LockCardField,
  LockCardFieldLabel,
  LockCardFieldValue,
  LockCardActions,
  LockCardButton,
} from "@mento-protocol/ui";

export const PersonalLock = () => (
  <LockCard>
    <LockCardHeader>
      <LockCardHeaderGroup>
        <LockCardAmount>1,500 MENTO</LockCardAmount>
        <LockCardName>Locked position</LockCardName>
      </LockCardHeaderGroup>
      <LockCardBadge type="personal">Personal</LockCardBadge>
    </LockCardHeader>
    <LockCardBody>
      <LockCardRow>
        <LockCardField>
          <LockCardFieldLabel>Voting power</LockCardFieldLabel>
          <LockCardFieldValue>1,320 veMENTO</LockCardFieldValue>
        </LockCardField>
        <LockCardField>
          <LockCardFieldLabel>Expires</LockCardFieldLabel>
          <LockCardFieldValue>Dec 31, 2026</LockCardFieldValue>
        </LockCardField>
      </LockCardRow>
    </LockCardBody>
    <LockCardActions>
      <LockCardButton>Extend lock</LockCardButton>
    </LockCardActions>
  </LockCard>
);

export const DelegatedLock = () => (
  <LockCard>
    <LockCardHeader>
      <LockCardHeaderGroup>
        <LockCardAmount>4,200 MENTO</LockCardAmount>
        <LockCardName>Delegated position</LockCardName>
      </LockCardHeaderGroup>
      <LockCardBadge type="delegated">Delegated</LockCardBadge>
    </LockCardHeader>
    <LockCardBody>
      <LockCardRow>
        <LockCardField>
          <LockCardFieldLabel>Voting power</LockCardFieldLabel>
          <LockCardFieldValue>3,940 veMENTO</LockCardFieldValue>
        </LockCardField>
        <LockCardField>
          <LockCardFieldLabel>Delegate</LockCardFieldLabel>
          <LockCardFieldValue>mento.eth</LockCardFieldValue>
        </LockCardField>
      </LockCardRow>
    </LockCardBody>
    <LockCardActions>
      <LockCardButton>Manage</LockCardButton>
    </LockCardActions>
  </LockCard>
);
