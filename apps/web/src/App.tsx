import { useRef, useState } from "react";
import type { PlayerRef } from "@remotion/player";
import { blankSpec, type Spec } from "@factory/composition/schema";
import { Author } from "./Author";
import { Preview } from "./Preview";
import { Queue } from "./Queue";
import { WorkerPill } from "./WorkerPill";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

// A tiny starter so the preview isn't empty on first load.
const SAMPLE: Spec = {
  id: "sample-reel",
  brand: { kicker: "தமிழ்நாடு", date: "12.07.2026", name: "THE HARDLINE", logo: "" },
  scenes: [
    {
      id: "s1_hook",
      image: "",
      caption: "தமிழ்நாட்டு அரசுப் பள்ளிகளில்\nஒரு பெரிய நெருக்கடி",
      stat: null,
      text: "தமிழ்நாட்டின் அரசுப் பள்ளிகள் இன்று ஒரு பெரிய கல்வி நெருக்கடியை சந்தித்து வருகின்றன.",
    },
    {
      id: "s2_stat",
      image: "",
      caption: "இரண்டு ஆண்டில் 5.9 லட்சம் சரிவு",
      stat: { value: "1,15,295", label: "மாணவர்கள் ஒரே ஆண்டில் குறைவு" },
      text: "ஒரே ஆண்டில் ஒரு லட்சத்து பதினைந்தாயிரம் மாணவர்கள் பொதுக் கல்வியிலிருந்து குறைந்துள்ளனர்.",
    },
  ],
};

type Tab = "author" | "queue";

export function App() {
  const [tab, setTab] = useState<Tab>("author");
  const [spec, setSpec] = useState<Spec>(SAMPLE);
  const playerRef = useRef<PlayerRef>(null);

  const tabBtn = (value: Tab, label: string) => (
    <button
      type="button"
      onClick={() => setTab(value)}
      className={cn(
        "rounded-md px-3 py-1 text-sm font-medium transition-colors",
        tab === value ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
      )}
    >
      {label}
    </button>
  );

  return (
    <TooltipProvider>
      <div className="min-h-screen">
        <header className="flex items-center gap-4 border-b border-border bg-card px-5 py-3">
          <h1 className="text-lg font-bold tracking-tight">
            <span className="text-primary">Hardline</span> Shorts
          </h1>
          <div className="ml-2 flex gap-1 rounded-lg bg-muted p-[3px]">
            {tabBtn("author", "Author")}
            {tabBtn("queue", "Queue & Review")}
          </div>
          <div className="ml-auto">
            <WorkerPill />
          </div>
        </header>

        {tab === "author" ? (
          <div className="grid items-start gap-5 p-5 lg:grid-cols-[1fr_420px]">
            <Author spec={spec} setSpec={setSpec} playerRef={playerRef} />
            <div className="space-y-3 lg:sticky lg:top-5">
              <Card className="gap-3 p-4">
                <h2 className="text-sm font-semibold">Live preview</h2>
                <Preview ref={playerRef} spec={spec} width={340} />
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setSpec(SAMPLE)}>
                    Load sample
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setSpec(blankSpec("reel-1"))}>
                    New blank
                  </Button>
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Preview uses the exact composition the server renders. Before draft audio, each
                  scene shows a placeholder duration.
                </p>
              </Card>
            </div>
          </div>
        ) : (
          <Queue />
        )}
      </div>
      <Toaster richColors position="bottom-right" />
    </TooltipProvider>
  );
}
