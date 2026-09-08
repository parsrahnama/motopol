import { useState, useEffect, useRef } from 'react';
import Head from 'next/head';
import { supabase } from '../lib/supabase';

const STEPS = [
  { key: 'pending', label: 'ثبت سفارش', icon: '📝' },
  { key: 'processing', label: 'آماده‌سازی', icon: '☕' },
  { key: 'out_for_delivery', label: 'پیک در مسیر', icon: '🛵' },
  { key: 'delivered', label: 'تحویل شد', icon: '✅' }
];

export default function MotopolApp() {
  const [customer, setCustomer] = useState(null);
  const [phoneInput, setPhoneInput] = useState('');
  const [authStep, setAuthStep] = useState('checking');
  const [regData, setRegData] = useState({ fullName: '', phone: '', shopName: '', shopAddress: '', addressNotes: '' });
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [activeCategory, setActiveCategory] = useState('همه');
  const [cart, setCart] = useState([]);
  const [loadingMenu, setLoadingMenu] = useState(true);
  const [lastOrder, setLastOrder] = useState(null);
  const [activeTab, setActiveTab] = useState('menu');
  const [submitting, setSubmitting] = useState(false);
  const orderChannel = useRef(null);

  useEffect(() => { initializeApp(); }, []);

  async function initializeApp() {
    const storedPhone = localStorage.getItem('motopol_phone');
    if (storedPhone) {
      setPhoneInput(storedPhone);
      await checkCustomer(storedPhone);
    } else {
      setAuthStep('login');
    }
  }

  async function checkCustomer(phone) {
    setAuthStep('checking');
    try {
      const { data, error } = await supabase.from('customers').select('*').eq('phone', phone).maybeSingle();
      if (data) {
        setCustomer(data);
        setAuthStep('app');
        localStorage.setItem('motopol_phone', phone);
        await fetchLastOrder(phone);
        await fetchProducts();
      } else {
        setAuthStep('register');
        if (phone) setRegData(prev => ({ ...prev, phone }));
      }
      if (error && error.code !== 'PGRST116') throw error;
    } catch (e) {
      console.error('Error checking customer:', e);
      setAuthStep('login');
    }
  }

  async function fetchLastOrder(phone) {
    try {
      let { data } = await supabase.from('orders').select('*')
        .eq('phone', phone)
        .in('status', ['pending', 'processing', 'out_for_delivery'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!data) {
        const res = await supabase.from('orders').select('*')
          .eq('phone', phone)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        data = res.data;
      }
      if (data) {
        setLastOrder(data);
        subscribeToOrderUpdates(data.id);
      } else {
        setLastOrder(null);
      }
    } catch (err) {
      console.error('Error fetching last order:', err);
    }
  }

  async function fetchProducts() {
    setLoadingMenu(true);
    try {
      const { data, error } = await supabase.from('products').select('*').eq('is_active', true).order('created_at', { ascending: true });
      if (error) throw error;
      setProducts(data || []);
      setCategories(['همه', ...new Set((data || []).map(p => p.category).filter(Boolean))]);
    } catch (err) {
      console.error('Error fetching products:', err);
    } finally {
      setLoadingMenu(false);
    }
  }

  const handleLoginSubmit = async (e) => {
    e.preventDefault();
    if (!phoneInput.trim()) { alert('لطفاً شماره موبایل معتبر وارد کنید.'); return; }
    await checkCustomer(phoneInput.trim());
  };

  const handleRegisterSubmit = async (e) => {
    e.preventDefault();
    if (!regData.fullName || !regData.phone || !regData.shopName || !regData.shopAddress) {
      alert('لطفاً تمام اطلاعات خواسته شده را تکمیل کنید.');
      return;
    }
    setSubmitting(true);
    try {
      const { data: existing } = await supabase.from('customers').select('*').eq('phone', regData.phone).maybeSingle();
      if (existing) {
        setCustomer(existing);
      } else {
        const { data, error } = await supabase.from('customers').insert([{
          phone: regData.phone,
          full_name: regData.fullName,
          shop_name: regData.shopName,
          shop_address: regData.shopAddress,
          address_notes: regData.addressNotes,
          is_vip: false,
          order_count: 0,
          total_spent: 0
        }]).select().single();
        if (error) throw error;
        setCustomer(data);
      }
      setAuthStep('app');
      localStorage.setItem('motopol_phone', regData.phone);
      await fetchLastOrder(regData.phone);
      await fetchProducts();
    } catch (e) {
      alert('خطا در ثبت‌نام: ' + e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const addToCart = (product) => {
    setCart(prev => {
      const idx = prev.findIndex(item => item.id === product.id);
      if (idx > -1) {
        const next = [...prev];
        next[idx] = { ...next[idx], quantity: next[idx].quantity + 1 };
        return next;
      }
      return [...prev, { ...product, quantity: 1 }];
    });
  };

  const updateCartQuantity = (productId, quantity) => {
    setCart(prev => quantity <= 0
      ? prev.filter(item => item.id !== productId)
      : prev.map(item => item.id === productId ? { ...item, quantity } : item)
    );
  };

  const grandTotal = cart.reduce((t, i) => t + i.price * i.quantity, 0);
  const isFreeDelivery = cart.length >= 2;
  const deliveryFee = isFreeDelivery ? 0 : 15000;

  const handlePlaceOrder = async () => {
    if (!customer || cart.length === 0) { alert('سبد خرید شما خالی است.'); return; }
    setSubmitting(true);
    try {
      const { data, error } = await supabase.from('orders').insert([{
        customer_id: customer.id,
        customer_name: customer.full_name,
        shop_name: customer.shop_name,
        phone: customer.phone,
        shop_address: customer.shop_address + (customer.address_notes ? ` (${customer.address_notes})` : ''),
        items: cart.map(item => ({ id: item.id, name: item.name, price: item.price, quantity: item.quantity })),
        total_price: grandTotal,
        delivery_fee: deliveryFee,
        status: 'pending'
      }]).select().single();
      if (error) throw error;

      await supabase.from('customers').update({
        order_count: (customer.order_count || 0) + 1,
        total_spent: Number(customer.total_spent || 0) + grandTotal
      }).eq('id', customer.id);

      setLastOrder(data);
      setCart([]);
      setActiveTab('track');
      subscribeToOrderUpdates(data.id);
    } catch (e) {
      alert('خطا در ثبت سفارش: ' + e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const subscribeToOrderUpdates = (orderId) => {
    if (orderChannel.current) supabase.removeChannel(orderChannel.current);
    orderChannel.current = supabase.channel(`order_track_${orderId}`)
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'orders', filter: `id=eq.${orderId}` },
        (payload) => setLastOrder(payload.new)
      )
      .subscribe();
  };

  const handleLogout = () => {
    localStorage.removeItem('motopol_phone');
    setCustomer(null);
    setLastOrder(null);
    setCart([]);
    setActiveTab('menu');
    setAuthStep('login');
    if (orderChannel.current) {
      supabase.removeChannel(orderChannel.current);
      orderChannel.current = null;
    }
  };

  const filteredProducts = activeCategory === 'همه' ? products : products.filter(p => p.category === activeCategory);
  const currentStepIdx = lastOrder ? STEPS.findIndex(s => s.key === lastOrder.status) : -1;
