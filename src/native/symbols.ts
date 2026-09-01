export const RDU_SYMBOLS = {
  rdu_abi_version: { parameters: [], result: "i32" },
  rdu_find_window: { parameters: ["buffer"], result: "pointer" },
  rdu_find_front_window: { parameters: [], result: "pointer" },
  rdu_attach: { parameters: ["pointer"], result: "i32" },
  rdu_detach: { parameters: ["pointer"], result: "void" },
  rdu_snapshot: { parameters: ["pointer", "buffer"], result: "i32" },
  rdu_poll_events: { parameters: ["pointer", "buffer", "i32"], result: "i32" },
  rdu_set_notify: {
    parameters: ["pointer"],
    result: "i32",
    optional: true,
  },
  rdu_audio_open: {
    parameters: ["u32", "u32", "u32"],
    result: "pointer",
  },
  rdu_audio_close: { parameters: ["pointer"], result: "void" },
  rdu_audio_info: { parameters: ["pointer", "buffer"], result: "i32" },
  rdu_audio_write: {
    parameters: ["pointer", "buffer", "i32"],
    result: "i32",
  },
  rdu_audio_pause: { parameters: ["pointer"], result: "i32" },
  rdu_audio_resume: { parameters: ["pointer"], result: "i32" },
} as const;

export type RduLibrary = Deno.DynamicLibrary<typeof RDU_SYMBOLS>;
