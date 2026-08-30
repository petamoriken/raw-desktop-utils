export const RDE_SYMBOLS = {
  rde_abi_version: { parameters: [], result: "i32" },
  rde_find_window: { parameters: ["buffer"], result: "pointer" },
  rde_find_front_window: { parameters: [], result: "pointer" },
  rde_attach: { parameters: ["pointer"], result: "i32" },
  rde_detach: { parameters: ["pointer"], result: "void" },
  rde_snapshot: { parameters: ["pointer", "buffer"], result: "i32" },
  rde_poll_events: { parameters: ["pointer", "buffer", "i32"], result: "i32" },
} as const;

export type RdeLibrary = Deno.DynamicLibrary<typeof RDE_SYMBOLS>;
