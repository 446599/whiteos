// Configure a PUBLIC artifact repository, not a private firmware source checkout.
export const firmwareSource = {
  owner: "446599",
  repo: "whiteos",
  ref: "63f53e88c6d06c75f76c6ad9756257379ed25174",
  manifestPath: "firmware/manifest.json",
};

// export const firmwareSource = {
//   owner: "YOUR_GITHUB_NAME",
//   repo: "whiteos-firmware",
//   ref: "main", // Resolved once to an immutable commit before downloading.
//   manifestPath: "firmware/manifest.json",
// };
