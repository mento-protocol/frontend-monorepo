import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@mento-protocol/ui";

export const OpenSelect = () => (
  <Select defaultValue="30" defaultOpen>
    <SelectTrigger style={{ width: 220 }}>
      <SelectValue placeholder="Select a duration" />
    </SelectTrigger>
    <SelectContent>
      <SelectItem value="7">7 days</SelectItem>
      <SelectItem value="30">30 days</SelectItem>
      <SelectItem value="90">90 days</SelectItem>
      <SelectItem value="365">1 year</SelectItem>
    </SelectContent>
  </Select>
);
