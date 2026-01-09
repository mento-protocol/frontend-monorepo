"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Textarea,
  Checkbox,
  RadioGroup,
  RadioGroupItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Slider,
  Calendar,
} from "@repo/ui";
import { useState } from "react";

export default function FormComponentsPage() {
  const [sliderValue, setSliderValue] = useState([50]);
  const [checkboxChecked, setCheckboxChecked] = useState(false);
  const [radioValue, setRadioValue] = useState("option1");
  const [selectValue, setSelectValue] = useState("");
  const [date, setDate] = useState<Date | undefined>(new Date());

  return (
    <div className="gap-8 p-6 flex w-full flex-col">
      <div className="space-y-2">
        <h1 className="font-bold text-3xl">Form Components</h1>
        <p className="text-muted-foreground">
          Input controls and form elements
        </p>
      </div>

      <div className="gap-6 md:grid-cols-2 lg:grid-cols-3 grid grid-cols-1">
        {/* Input & Textarea */}
        <Card>
          <CardHeader>
            <CardTitle>Text Inputs</CardTitle>
            <CardDescription>Text input and textarea fields</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="input-demo">Input Field</Label>
              <Input id="input-demo" placeholder="Enter text..." />
            </div>
            <div className="space-y-2">
              <Label htmlFor="textarea-demo">Textarea</Label>
              <Textarea id="textarea-demo" placeholder="Enter longer text..." />
            </div>
          </CardContent>
        </Card>

        {/* Checkbox & Radio */}
        <Card>
          <CardHeader>
            <CardTitle>Selection Controls</CardTitle>
            <CardDescription>Checkboxes and radio buttons</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-x-2 flex items-center">
              <Checkbox
                id="checkbox-demo"
                checked={checkboxChecked}
                onCheckedChange={(checked) =>
                  setCheckboxChecked(checked === true)
                }
              />
              <Label htmlFor="checkbox-demo">Checkbox option</Label>
            </div>

            <RadioGroup value={radioValue} onValueChange={setRadioValue}>
              <div className="space-x-2 flex items-center">
                <RadioGroupItem value="option1" id="r1" />
                <Label htmlFor="r1">Option 1</Label>
              </div>
              <div className="space-x-2 flex items-center">
                <RadioGroupItem value="option2" id="r2" />
                <Label htmlFor="r2">Option 2</Label>
              </div>
            </RadioGroup>
          </CardContent>
        </Card>

        {/* Select & Slider */}
        <Card>
          <CardHeader>
            <CardTitle>Advanced Inputs</CardTitle>
            <CardDescription>Select dropdowns and sliders</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Select Option</Label>
              <Select value={selectValue} onValueChange={setSelectValue}>
                <SelectTrigger>
                  <SelectValue placeholder="Select an option" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="option1">Option 1</SelectItem>
                  <SelectItem value="option2">Option 2</SelectItem>
                  <SelectItem value="option3">Option 3</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Slider ({sliderValue[0]})</Label>
              <Slider
                value={sliderValue}
                onValueChange={setSliderValue}
                max={100}
                step={1}
              />
            </div>
          </CardContent>
        </Card>

        {/* Calendar */}
        <Card>
          <CardHeader>
            <CardTitle>Calendar</CardTitle>
            <CardDescription>Date picker component</CardDescription>
          </CardHeader>
          <CardContent>
            <Calendar
              mode="single"
              selected={date}
              onSelect={setDate}
              className="rounded-md border"
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
