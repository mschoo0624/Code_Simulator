import { z } from "zod";

export const VIZ_KINDS = [
  "array",
  "bits_array",
  "grid",
  "linked_list",
  "tree",
  "graph",
  "memory",
  "variables",
] as const;

export const AnnotationSchema = z.object({
  viz: z.enum(VIZ_KINDS),
  primary: z.string(),
  pointers: z.array(z.string()),
  captions: z.array(z.object({ idx: z.number(), text: z.string() })),
  insight: z.string(),
  complexity: z.object({ time: z.string(), space: z.string() }),
});
export type Annotation = z.infer<typeof AnnotationSchema>;
