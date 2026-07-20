/**
 * Bundled demo dataset — v11 onboarding.
 * Shaped so every feature fires: an upward revenue trend (forecast),
 * a couple of missing cells + duplicate rows (insights, quality),
 * one dominant category and an outlier (marginalia).
 */
const CSV = `month,region,product,units,price,revenue
2025-01,Bangkok,Widget,120,49.0,5880
2025-01,Bangkok,Gadget,80,89.0,7120
2025-01,Chiangmai,Widget,40,49.0,1960
2025-02,Bangkok,Widget,135,49.0,6615
2025-02,Bangkok,Gadget,85,89.0,7565
2025-02,Chiangmai,Widget,45,49.0,2205
2025-03,Bangkok,Widget,150,49.0,7350
2025-03,Bangkok,Gadget,95,89.0,8455
2025-03,Chiangmai,Widget,,49.0,
2025-04,Bangkok,Widget,166,49.0,8134
2025-04,Bangkok,Gadget,102,89.0,9078
2025-04,Chiangmai,Widget,52,49.0,2548
2025-05,Bangkok,Widget,180,49.0,8820
2025-05,Bangkok,Gadget,110,89.0,9790
2025-05,Chiangmai,Widget,58,49.0,2842
2025-06,Bangkok,Widget,196,49.0,9604
2025-06,Bangkok,Gadget,118,89.0,10502
2025-06,Chiangmai,Widget,61,49.0,2989
2025-06,Bangkok,Widget,196,49.0,9604
2025-07,Bangkok,Widget,210,49.0,10290
2025-07,Bangkok,Gadget,127,89.0,11303
2025-07,Chiangmai,Widget,66,49.0,3234
2025-08,Bangkok,Widget,225,49.0,11025
2025-08,Bangkok,Gadget,,89.0,
2025-08,Chiangmai,Widget,70,49.0,3430
2025-09,Bangkok,Widget,240,49.0,11760
2025-09,Bangkok,Gadget,141,89.0,12549
2025-09,Chiangmai,Widget,74,49.0,3626
2025-09,Bangkok,Widget,240,49.0,11760
2025-10,Bangkok,Widget,900,49.0,44100
2025-10,Bangkok,Gadget,150,89.0,13350
2025-10,Chiangmai,Widget,79,49.0,3871`;

export function makeSampleFile() {
  return new File([CSV], "sample-sales.csv", { type: "text/csv" });
}
