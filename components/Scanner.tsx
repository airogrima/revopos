import { useEffect, useRef, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { C } from "../theme";
import { Ghost, Primary } from "./mini";

/** Full-screen camera that reads one barcode, QR code or serial label and returns its text. */
export default function Scanner({ visible, title, onClose, onScan }: { visible: boolean; title: string; onClose: () => void; onScan: (text: string) => void }) {
  const [perm, ask] = useCameraPermissions();
  const done = useRef(false);
  const [manual, setManual] = useState(false);
  useEffect(() => { if (visible) { done.current = false; setManual(false); } }, [visible]);
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={s.wrap}>
        <Text style={s.title}>{title}</Text>
        {!perm ? null : !perm.granted ? (
          <View style={s.center}>
            <Text style={s.msg}>Allow the camera to scan, or type the number instead.</Text>
            <Primary label="Allow camera" onPress={() => void ask()} />
          </View>
        ) : !manual ? (
          <CameraView style={s.camera} facing="back"
            barcodeScannerSettings={{ barcodeTypes: ["ean13", "ean8", "upc_a", "upc_e", "code128", "code39", "code93", "itf14", "qr", "datamatrix", "pdf417"] }}
            onBarcodeScanned={({ data }) => { if (done.current || !data) return; done.current = true; onScan(data.trim()); }} />
        ) : null}
        <View style={s.foot}>
          <Pressable onPress={onClose}><Text style={s.close}>Close</Text></Pressable>
        </View>
      </View>
    </Modal>
  );
}
const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: "#000", paddingTop: 54 },
  title: { color: "#fff", fontSize: 16, fontWeight: "600", textAlign: "center", marginBottom: 10 },
  camera: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  msg: { color: "#fff", textAlign: "center", marginBottom: 14 },
  foot: { padding: 18, alignItems: "center" },
  close: { color: "#fff", fontSize: 16, fontWeight: "600" },
});
void Ghost; void C;
