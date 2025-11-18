import * as Blockly from "blockly";

/** VisionBlocks Light – soft blue/grey */
export const LightTheme = Blockly.Theme.defineTheme("visionblocks-light", {
  base: Blockly.Themes.Classic,
  componentStyles: {
    workspaceBackgroundColour: "#E3E8F4", // soft grey-blue
    toolboxBackgroundColour: "#D7DEEF",   // slightly darker strip
    toolboxForegroundColour: "#0F172A",   // slate-900
    flyoutBackgroundColour: "#F9FAFB",
    flyoutForegroundColour: "#0F172A",
    flyoutOpacity: 0.98,
    scrollbarColour: "#CBD5F5",           // light indigo-grey
    scrollbarOpacity: 0.85,
    insertionMarkerColour: "#38BDF8",     // sky-400
    insertionMarkerOpacity: 0.35,
    cursorColour: "#38BDF8",
  },
});

/** VisionBlocks Dark – used by other modules if needed */
export const DarkTheme = Blockly.Theme.defineTheme("visionblocks-dark", {
  base: Blockly.Themes.Classic,
  componentStyles: {
    workspaceBackgroundColour: "#020617",  // slate-950
    toolboxBackgroundColour: "#020617",
    toolboxForegroundColour: "#E5E7EB",
    flyoutBackgroundColour: "#020617",
    flyoutForegroundColour: "#E5E7EB",
    flyoutOpacity: 0.98,
    scrollbarColour: "#4B5563",
    scrollbarOpacity: 0.85,
    insertionMarkerColour: "#38BDF8",
    insertionMarkerOpacity: 0.4,
    cursorColour: "#38BDF8",
  },
});
