import type { ComponentType } from "react";
import type { VizKind } from "../types";
import type { VizProps } from "./VizProps";
import { ArrayView } from "./ArrayView";
import { BitsArrayView } from "./BitsArrayView";
import { GraphView } from "./GraphView";
import { GridView } from "./GridView";
import { LinkedListView } from "./LinkedListView";
import { MemoryView } from "./MemoryView";
import { TreeView } from "./TreeView";
import { VariablesView } from "./VariablesView";

export const registry: Record<VizKind, ComponentType<VizProps>> = {
  variables: VariablesView,
  array: ArrayView,
  bits_array: BitsArrayView,
  grid: GridView,
  linked_list: LinkedListView,
  tree: TreeView,
  graph: GraphView,
  memory: MemoryView,
};
