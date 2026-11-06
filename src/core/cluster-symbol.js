// Clusters have no fixed root or pitch set; they are complete chord-field symbols.
export const CLUSTER_SYMBOLS = new Map([
  ["Clus", { type: "cluster", suffix: "" }],
  ["ClusWK", { type: "white-key-cluster", suffix: "WK" }],
  ["ClusBK", { type: "black-key-cluster", suffix: "BK" }],
]);
