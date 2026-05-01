import React from 'react';
import { useWindowDimensions, View, ActivityIndicator, Text } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { MaterialIcons } from '@expo/vector-icons';
import { RootStackParamList, TabParamList, CustomerTabParamList } from '../types';
import { Colors } from '../utils/constants';
import { useCart } from '../context/CartContext';
import { useAuth } from '../context/AuthContext';

import SplashScreen from '../screens/SplashScreen';
import RoleSelectScreen from '../screens/RoleSelectScreen';
import HomeScreen from '../screens/HomeScreen';
import ProductsScreen from '../screens/ProductsScreen';
import AddProductScreen from '../screens/AddProductScreen';
import OrdersScreen from '../screens/OrdersScreen';
import ReportsScreen from '../screens/ReportsScreen';
import SettingsScreen from '../screens/SettingsScreen';
import BillingScreen from '../screens/BillingScreen';
import QRMenuScreen from '../screens/QRMenuScreen';
import ChatScreen from '../screens/ChatScreen';
import CustomerMenuScreen from '../screens/CustomerMenuScreen';
import CustomerCartScreen from '../screens/CustomerCartScreen';
import CustomerOrderConfirmScreen from '../screens/CustomerOrderConfirmScreen';
import AdminLoginScreen from '../screens/AdminLoginScreen';
import BusinessSetupScreen from '../screens/BusinessSetupScreen';
import SuperAdminLoginScreen from '../screens/SuperAdminLoginScreen';
import SuperAdminDashboardScreen from '../screens/SuperAdminDashboardScreen';
import SupportScreen from '../screens/SupportScreen';
import HotelStatusScreen from '../screens/HotelStatusScreen';
import CategoriesScreen from '../screens/CategoriesScreen';

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab   = createBottomTabNavigator<TabParamList>();
const CTab  = createBottomTabNavigator<CustomerTabParamList>();

const TAB_ICONS: Record<string, keyof typeof MaterialIcons.glyphMap> = {
  Home:     'home',
  Billing:  'receipt',
  Orders:   'receipt-long',
  Reports:  'bar-chart',
  Products: 'restaurant-menu',
  Support:  'support-agent',
  Settings: 'settings',
};

// ── Admin Tab Navigator ───────────────────────────────────────────────────────
const TabNavigator = () => {
  const { width } = useWindowDimensions();
  const isSmall = width < 380;

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarIcon: ({ color, focused }) => (
          <MaterialIcons
            name={TAB_ICONS[route.name] || 'circle'}
            size={focused ? 26 : 22}
            color={color}
          />
        ),
        tabBarActiveTintColor: Colors.primary,
        tabBarInactiveTintColor: Colors.textMuted,
        tabBarStyle: {
          backgroundColor: Colors.surface,
          borderTopColor: Colors.border,
          borderTopWidth: 1.5,
          height: isSmall ? 60 : 70,
          paddingBottom: isSmall ? 8 : 12,
          paddingTop: isSmall ? 4 : 6,
          shadowColor: '#8B3A1A',
          shadowOffset: { width: 0, height: -3 },
          shadowOpacity: 0.08,
          shadowRadius: 8,
          elevation: 10,
        },
        tabBarLabelStyle: {
          fontSize: isSmall ? 9 : 11,
          fontWeight: '700',
          marginTop: -2,
        },
        tabBarItemStyle: { paddingVertical: 2 },
      })}
    >
      <Tab.Screen name="Home"     component={HomeScreen}     options={{ tabBarLabel: 'Home' }} />
      <Tab.Screen name="Billing"  component={BillingScreen} options={{ tabBarLabel: 'Billing' }} />
      <Tab.Screen name="Orders"   component={OrdersScreen}   options={{ tabBarLabel: 'Orders' }} />
      <Tab.Screen name="Reports"  component={ReportsScreen}  options={{ tabBarLabel: 'Reports' }} />
      <Tab.Screen name="Settings" component={SettingsScreen} options={{ tabBarLabel: 'Settings' }} />
    </Tab.Navigator>
  );
};

// ── Customer Tab Navigator ────────────────────────────────────────────────────
const CustomerTabNavigator = () => {
  const { itemCount } = useCart();
  const { width } = useWindowDimensions();
  const isSmall = width < 380;

  return (
    <CTab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: Colors.primary,
        tabBarInactiveTintColor: Colors.textMuted,
        tabBarStyle: {
          backgroundColor: Colors.surface,
          borderTopColor: Colors.border,
          borderTopWidth: 1,
          height: isSmall ? 58 : 68,
          paddingBottom: isSmall ? 6 : 10,
          paddingTop: isSmall ? 4 : 6,
        },
        tabBarLabelStyle: {
          fontSize: isSmall ? 11 : 13,
          fontWeight: '700',
        },
      }}
    >
      <CTab.Screen
        name="Menu"
        component={CustomerMenuScreen}
        options={{
          tabBarLabel: 'Menu',
          tabBarIcon: ({ color, focused }) => (
            <MaterialIcons name="restaurant-menu" size={focused ? 26 : 22} color={color} />
          ),
        }}
      />
      <CTab.Screen
        name="Cart"
        component={CustomerCartScreen}
        options={{
          tabBarLabel: 'Cart',
          tabBarIcon: ({ color, focused }) => (
            <MaterialIcons name="shopping-cart" size={focused ? 26 : 22} color={color} />
          ),
          tabBarBadge: itemCount > 0 ? itemCount : undefined,
          tabBarBadgeStyle: {
            backgroundColor: Colors.primary,
            color: Colors.white,
            fontSize: 10,
            fontWeight: '800',
            minWidth: 18,
            height: 18,
            lineHeight: 18,
          },
        }}
      />
    </CTab.Navigator>
  );
};

// ── Root Navigator ────────────────────────────────────────────────────────────
const AppNavigator = () => {
  const { isLoggedIn, isAuthLoading } = useAuth();

  if (isAuthLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.background }}>
        <Text style={{ fontSize: 48, marginBottom: 16 }}>🍽️</Text>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
        {!isLoggedIn ? (
          <>
            <Stack.Screen name="Splash"               component={SplashScreen} />
            <Stack.Screen name="RoleSelect"           component={RoleSelectScreen} />
            <Stack.Screen name="AdminLogin"           component={AdminLoginScreen} />
            <Stack.Screen name="BusinessSetup"        component={BusinessSetupScreen} />
            <Stack.Screen name="SuperAdminLogin"      component={SuperAdminLoginScreen} />
            <Stack.Screen name="SuperAdminDashboard"  component={SuperAdminDashboardScreen} />
            <Stack.Screen name="HotelStatus"          component={HotelStatusScreen} />
            <Stack.Screen name="CustomerTabs"         component={CustomerTabNavigator} />
            <Stack.Screen name="CustomerOrderConfirm" component={CustomerOrderConfirmScreen} />
          </>
        ) : (
          <>
            <Stack.Screen name="MainTabs" component={TabNavigator} />
            <Stack.Screen name="Support"  component={SupportScreen} />
            <Stack.Screen
              name="AddProduct"
              component={AddProductScreen}
              options={{
                headerShown: true,
                headerTitle: 'Product',
                headerStyle: { backgroundColor: Colors.surface },
                headerTintColor: Colors.text,
                animation: 'slide_from_bottom',
              }}
            />
            <Stack.Screen
              name="Categories"
              component={CategoriesScreen}
              options={{ headerShown: false, animation: 'slide_from_right' }}
            />
            <Stack.Screen
              name="Products"
              component={ProductsScreen}
              options={{ headerShown: false, animation: 'slide_from_right' }}
            />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
};

export default AppNavigator;
