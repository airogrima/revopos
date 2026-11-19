/**
 * Navigation.
 *
 * React Navigation rather than expo-router: the app was a single App.tsx with a
 * plain `registerRootComponent` entry, and expo-router would mean restructuring
 * into an app/ directory and swapping the entry point. This project has twice
 * been broken by mobile dependency churn — SDK downgrades left react-native
 * mismatched against expo and needed a full node_modules wipe — so the smaller
 * change wins. expo-router is built ON React Navigation, so if we move later
 * the screens port across unchanged; it is the file layout and entry point that
 * change, not the components.
 *
 * FOUR tabs, not fourteen. The web sidebar's fourteen destinations cannot map
 * onto a phone tab bar — past four the labels truncate and the targets get too
 * small. The four chosen are the things someone does standing in a shop:
 *
 *   Home      the money position at a glance
 *   Invoices  who owes what — the reason an owner opens this app
 *   Reports   VAT, aging and sales, for the questions that come up away from a desk
 *   More      everything else, as a list
 *
 * Receipt capture is deliberately NOT a tab yet, even though it is the app's
 * headline phone feature. It has no implementation at all — schema only — and
 * giving the most valuable slot on the screen to something that cannot do
 * anything trains people to ignore it. It sits in More with an honest label
 * until it works, and should take the centre tab the day it does.
 */

import { Pressable, View } from "react-native";
import { NavigationContainer, DefaultTheme, useNavigation } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { C } from "./theme";
import { Icon } from "./components/kit";

import DashboardScreen from "./screens/DashboardScreen";
import MoreScreen from "./screens/MoreScreen";
import InvoicesScreen from "./screens/InvoicesScreen";
import ReportsScreen from "./screens/ReportsScreen";
import CustomersScreen from "./screens/CustomersScreen";
import ExpensesScreen from "./screens/ExpensesScreen";
import PricingScreen from "./screens/PricingScreen";
import ModulesScreen from "./screens/ModulesScreen";
import LockGate from "./components/LockGate";
import { useCreateMenu, useLongPressAnchor } from "./components/CreateMenu";
import PurchasesScreen from "./screens/PurchasesScreen";
import AddPurchaseScreen from "./screens/AddPurchaseScreen";
import SettingsScreen from "./screens/SettingsScreen";
import ReceiptsScreen from "./screens/ReceiptsScreen";
import HelpScreen from "./screens/HelpScreen";
import AddCustomerScreen from "./screens/AddCustomerScreen";
import AddItemScreen from "./screens/AddItemScreen";
import AddExpenseScreen from "./screens/AddExpenseScreen";
import CaptureReceiptScreen from "./screens/CaptureReceiptScreen";
import CreateInvoiceScreen from "./screens/CreateInvoiceScreen";
import PosScreen from "./screens/PosScreen";
import ProductionScreen from "./screens/ProductionScreen";
import HrmScreen from "./screens/HrmScreen";
import TasksScreen from "./screens/TasksScreen";
import BankAccountsScreen from "./screens/BankAccountsScreen";
import BudgetsScreen from "./screens/BudgetsScreen";
import {
  ConstructionScreen, ElectronicsScreen, FashionScreen, HotelScreen, PharmacyScreen, StockAlertsScreen,
} from "./screens/IndustryScreens";
import RestaurantScreen from "./screens/RestaurantScreen";
import StockScreen from "./screens/StockScreen";
import { BranchesScreen, StaffScreen } from "./screens/OrgScreens";
/*
 * BankScreen and BudgetsScreen are deliberately NOT imported.
 *
 * Both features are locked for every plan. Disabling the row in the More list
 * was presentation only — the routes stayed registered, so nav.navigate("Bank")
 * from anywhere still opened the real screen and it still ran its queries. The
 * web enforces this server-side; mobile must not be weaker. An unregistered
 * route cannot be navigated to at all, which is the strongest form of the lock
 * available on the client.
 *
 * They come back by re-adding the import and the two <Screen> entries, at the
 * same time as the plan_features rows are flipped to allowed.
 */
import {
  EstimatesScreen, ItemsScreen, PaymentsScreen,
} from "./screens/MoneyScreens";

/**
 * Browsing destinations. These live inside the More tab and are only ever
 * reached from the More list, so they belong to its stack.
 */
export type MoreStackParamList = {
  MoreHome: undefined;
  StockAlerts: undefined;
  Stock: undefined;
  Restaurant: undefined;
  Hotel: undefined;
  Pharmacy: undefined;
  Fashion: undefined;
  Electronics: undefined;
  Construction: undefined;
  Reports: undefined;
  Expenses: undefined;
  Receipts: undefined;
  Estimates: undefined;
  Items: undefined;
  Payments: undefined;
  Settings: undefined;
  Pricing: undefined;
  Modules: undefined;
  Purchases: undefined;
  Help: undefined;
  Pos: undefined;
  Production: undefined;
  Hrm: undefined;
  Tasks: undefined;
  BankAccounts: undefined;
  Budgets: undefined;
  Branches: undefined;
  Staff: undefined;
};

/**
 * The write screens, and why they are here rather than in MoreStack.
 *
 * CreateInvoice used to be registered inside MoreStack while InvoicesScreen —
 * which is a TAB, a sibling of More, not a child of it — called
 * navigate("CreateInvoice"). React Navigation had nowhere to deliver that, and
 * every attempt to create an invoice from the Invoices tab died with
 * "The action 'NAVIGATE' with payload {"name":"CreateInvoice"} was not handled
 * by any navigator." The other five worked only because they happened to be
 * called from screens already inside More.
 *
 * Starting a task is not a property of where you happen to be standing. These
 * five sit ABOVE the tab navigator so any screen can open them, which removes
 * the whole class of bug rather than the one instance of it.
 */
export type RootStackParamList = {
  Tabs: undefined;
  AddCustomer: undefined;
  AddItem: undefined;
  AddExpense: undefined;
  CaptureReceipt: undefined;
  /** `edit` reopens a draft (same id and number); `duplicate` starts a NEW draft from an existing invoice. */
  CreateInvoice: { mode: "edit" | "duplicate"; documentId: string } | undefined;
  /** `draftId` reopens a purchase draft (separate from posted purchases) for editing, confirming or deleting. */
  AddPurchase: { draftId: string } | undefined;
};

const Tab = createBottomTabNavigator();
const MoreStack = createNativeStackNavigator<MoreStackParamList>();
const RootStack = createNativeStackNavigator<RootStackParamList>();

/**
 * The More tab is a stack so its sub-screens get a native back gesture and a
 * titled header. Everything else is a single screen and does not need one.
 */
function MoreNavigator() {
  return (
    <MoreStack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: C.bg },
        headerTintColor: C.primary,
        headerTitleStyle: { color: C.text, fontSize: 16, fontWeight: "600" },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: C.bg },
      }}
    >
      <MoreStack.Screen name="MoreHome" component={MoreScreen} options={{ headerShown: false }} />
      <MoreStack.Screen name="Reports"   component={ReportsScreen}   options={{ title: "Reports" }} />
      <MoreStack.Screen name="Expenses"  component={ExpensesScreen}  options={{ title: "Expenses" }} />
      <MoreStack.Screen name="Receipts"  component={ReceiptsScreen}  options={{ title: "Receipts" }} />
      <MoreStack.Screen name="Estimates" component={EstimatesScreen} options={{ title: "Quotations / Estimates" }} />
      <MoreStack.Screen name="Items"     component={ItemsScreen}     options={{ title: "Products / Services" }} />
      <MoreStack.Screen name="Payments"  component={PaymentsScreen}  options={{ title: "Payments" }} />
      <MoreStack.Screen name="Settings"  component={SettingsScreen}  options={{ title: "Settings" }} />
      <MoreStack.Screen name="Pricing"   component={PricingScreen}   options={{ title: "Your plan" }} />
      <MoreStack.Screen name="Modules"   component={ModulesScreen}   options={{ title: "Industry & modules" }} />
      <MoreStack.Screen name="Purchases" component={PurchasesScreen} options={{ title: "Purchases" }} />
      <MoreStack.Screen name="Help"      component={HelpScreen}      options={{ title: "Help & Support" }} />
      <MoreStack.Screen name="Pos"          component={PosScreen}          options={{ title: "POS Sales" }} />
      <MoreStack.Screen name="Production"   component={ProductionScreen}   options={{ title: "Production" }} />
      <MoreStack.Screen name="Hrm"          component={HrmScreen}          options={{ title: "HRM" }} />
      <MoreStack.Screen name="Tasks"        component={TasksScreen}        options={{ title: "To-Do List" }} />
      <MoreStack.Screen name="BankAccounts" component={BankAccountsScreen} options={{ title: "Bank accounts" }} />
      <MoreStack.Screen name="Budgets"      component={BudgetsScreen}      options={{ title: "Budgets" }} />
      <MoreStack.Screen name="Branches"     component={BranchesScreen}     options={{ title: "Branches" }} />
      <MoreStack.Screen name="Staff"        component={StaffScreen}        options={{ title: "Staff & Roles" }} />
      <MoreStack.Screen name="Stock"        component={StockScreen}        options={{ title: "Stock" }} />
      <MoreStack.Screen name="StockAlerts"  component={StockAlertsScreen}  options={{ title: "Stock alerts" }} />
      <MoreStack.Screen name="Restaurant"   component={RestaurantScreen}   options={{ title: "Restaurant" }} />
      <MoreStack.Screen name="Hotel"        component={HotelScreen}        options={{ title: "Hotel" }} />
      <MoreStack.Screen name="Pharmacy"     component={PharmacyScreen}     options={{ title: "Pharmacy" }} />
      <MoreStack.Screen name="Fashion"      component={FashionScreen}      options={{ title: "Fashion orders" }} />
      <MoreStack.Screen name="Electronics"  component={ElectronicsScreen}  options={{ title: "Warranty lookup" }} />
      <MoreStack.Screen name="Construction" component={ConstructionScreen} options={{ title: "Projects" }} />
    </MoreStack.Navigator>
  );
}

/**
 * Tab icons are small SVG line icons (components/kit), drawn with
 * react-native-svg which the app already ships, so there is still no icon font.
 */
function tabIcon(name: string) {
  return ({ color }: { color: string }) => <Icon name={name} size={22} color={color} />;
}

/** Never rendered: the Create tab intercepts its own press. */
function CreatePlaceholder() { return null; }

/**
 * The green + tab button. A tap opens Create Invoice exactly as before; a long
 * press opens the sales / purchase popover anchored to the button. Pressable
 * never runs onPress for a press that already long-pressed, so they cannot both fire.
 */
function CreateTabButton({ accessibilityState, children, style }: { accessibilityState?: object; children?: React.ReactNode; style?: object }) {
  const nav = useNavigation<{ navigate: (n: string) => void }>();
  const menu = useCreateMenu(() => nav.navigate("CreateInvoice"), () => nav.navigate("AddPurchase"));
  const hold = useLongPressAnchor(menu.open);
  return (
    <>
      {menu.node}
      <Pressable ref={hold.ref} onPress={() => nav.navigate("CreateInvoice")} onLongPress={hold.onLongPress} delayLongPress={380}
        accessibilityRole="button" accessibilityLabel="Create" accessibilityHint="Press and hold for sales or purchase invoice"
        accessibilityState={accessibilityState as never}
        accessibilityActions={[{ name: "longpress", label: "More create options" }]}
        onAccessibilityAction={(e) => { if (e.nativeEvent.actionName === "longpress") hold.onLongPress(); }}
        style={[style, { flex: 1, alignItems: "center", justifyContent: "flex-start" }]}>
        {children}
      </Pressable>
    </>
  );
}

function createIcon() {
  return (
    <View style={{
      width: 46, height: 46, borderRadius: 23, backgroundColor: C.forest,
      alignItems: "center", justifyContent: "center", marginTop: -14,
      shadowColor: C.forest, shadowOpacity: 0.35, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 6,
      borderWidth: 3, borderColor: "#fff",
    }}>
      <Icon name="plus" size={22} color="#fff" strokeWidth={2.8} />
    </View>
  );
}

const navTheme = {
  ...DefaultTheme,
  colors: { ...DefaultTheme.colors, background: C.bg, card: C.card, primary: C.primary, border: C.border2 },
};

function Tabs() {
  const insets = useSafeAreaInsets();
  return (
      <Tab.Navigator
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: C.forest,
          tabBarInactiveTintColor: C.text3,
          tabBarStyle: {
            backgroundColor: "#fff", borderTopColor: C.border2, borderTopWidth: 1,
            // Explicit height so the label is never clipped, with the home indicator inset added.
            height: 60 + insets.bottom, paddingTop: 6, paddingBottom: Math.max(insets.bottom, 6),
          },
          tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
        }}
      >
        <Tab.Screen name="Home" component={DashboardScreen}
                    options={{ tabBarIcon: tabIcon("home") }} />
        <Tab.Screen name="Invoices" component={InvoicesScreen}
                    options={{ tabBarIcon: tabIcon("invoice") }} />
        {/*
          The create action is a tab-bar button, not a screen. It never becomes
          the selected tab: tapping it opens the same CreateInvoice modal the
          Invoices screen opens, via the root stack where that route lives.
        */}
        <Tab.Screen name="Create" component={CreatePlaceholder}
                    options={{ tabBarLabel: "Create", tabBarIcon: createIcon, tabBarButton: (props) => <CreateTabButton {...(props as object)} /> }}
                    listeners={({ navigation }) => ({
                      tabPress: (e) => {
                        e.preventDefault();
                        navigation.getParent()?.navigate("CreateInvoice");
                      },
                    })} />
        <Tab.Screen name="Contacts" component={CustomersScreen}
                    options={{ tabBarIcon: tabIcon("users") }} />
        <Tab.Screen name="More" component={MoreNavigator}
                    options={{ tabBarIcon: tabIcon("grid") }} />
      </Tab.Navigator>
  );
}

export default function RootNavigation() {
  return (
    <LockGate>
    <NavigationContainer theme={navTheme}>
      <RootStack.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: C.bg },
          headerTintColor: C.primary,
          headerTitleStyle: { color: C.text, fontSize: 16, fontWeight: "600" },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: C.bg },
        }}
      >
        <RootStack.Screen name="Tabs" component={Tabs} options={{ headerShown: false }} />

        {/*
          Presented as modals so they read as a task you are in the middle of
          rather than a place you have navigated to — and so cancelling returns
          you exactly where you were, whichever tab that was.
        */}
        <RootStack.Screen name="AddCustomer"    component={AddCustomerScreen}    options={{ title: "New customer", presentation: "modal" }} />
        <RootStack.Screen name="AddItem"        component={AddItemScreen}        options={{ title: "New item", presentation: "modal" }} />
        <RootStack.Screen name="AddExpense"     component={AddExpenseScreen}     options={{ title: "Record expense", presentation: "modal" }} />
        <RootStack.Screen name="CaptureReceipt" component={CaptureReceiptScreen} options={{ title: "Capture receipt", presentation: "modal" }} />
        <RootStack.Screen name="CreateInvoice"  component={CreateInvoiceScreen}  options={{ title: "New invoice", presentation: "modal", headerShown: false }} />
        <RootStack.Screen name="AddPurchase"    component={AddPurchaseScreen}    options={{ title: "Record purchase", presentation: "modal", headerShown: false }} />
      </RootStack.Navigator>
    </NavigationContainer>
    </LockGate>
  );
}
