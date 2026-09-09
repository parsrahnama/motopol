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

  const [regData, setRegData] = useState({
    fullName: '',
    phone: '',
    shopName: '',
    shopAddress: '',
    addressNotes: ''
  });

  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [activeCategory, setActiveCategory] = useState('همه');
  const [cart, setCart] = useState([]);
  const [loadingMenu, setLoadingMenu] = useState(true);
  const [lastOrder, setLastOrder] = useState(null);
  const [activeTab, setActiveTab] = useState('menu');
  const [submitting, setSubmitting] = useState(false);
  const [editingProfile, setEditingProfile] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [editingOrder, setEditingOrder] = useState(false);
  const [orderEditSaving, setOrderEditSaving] = useState(false);
  const [editSecondsLeft, setEditSecondsLeft] = useState(0);

  const orderChannel = useRef(null);

  useEffect(() => {
    initializeApp();

    return () => {
      if (orderChannel.current) {
        supabase.removeChannel(orderChannel.current);
      }
    };
  }, []);

  async function initializeApp() {
    if (typeof window === 'undefined') return;

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
      const cleanPhone = phone.trim();

      const { data, error } = await supabase
        .from('customers')
        .select('*')
        .eq('phone', cleanPhone)
        .maybeSingle();

      if (error) {
        throw error;
      }

      if (data) {
        setCustomer(data);
        setAuthStep('app');

        localStorage.setItem('motopol_phone', cleanPhone);

        await fetchLastOrder(cleanPhone, data.id);
        await fetchProducts(data);
      } else {
        setAuthStep('register');

        if (cleanPhone) {
          setRegData(prev => ({
            ...prev,
            phone: cleanPhone
          }));
        }
      }
    } catch (e) {
      console.error('Error checking customer:', e);
      setAuthStep('login');
    }
  }

  async function fetchOrderWithItems(orderId) {
    if (!orderId) return null;

    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('*')
      .eq('id', orderId)
      .maybeSingle();

    if (orderError) throw orderError;
    if (!order) return null;

    const { data: items, error: itemsError } = await supabase
      .from('order_items')
      .select('*')
      .eq('order_id', orderId)
      .order('created_at', { ascending: true });

    if (itemsError) throw itemsError;

    return {
      ...order,
      items: items || []
    };
  }

  async function fetchLastOrder(phone, customerId = customer?.id) {
    try {
      const { data: customerOrders, error } = await supabase
        .from('orders')
        .select('*')
        .eq('customer_id', customerId || '')
        .in('status', ['new', 'preparing', 'sent'])
        .order('created_at', { ascending: false })
        .limit(1);

      if (error) {
        console.error('Active order fetch error:', error);
      }

      let data = customerOrders?.[0] || null;

      if (!data) {
        const res = await supabase
          .from('orders')
          .select('*')
          .eq('customer_id', customerId || '')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (res.error) {
          console.error('Last order fetch error:', res.error);
        }

        data = res.data;
      }

      if (data) {
        const fullOrder = await fetchOrderWithItems(data.id);
        setLastOrder(fullOrder);
        subscribeToOrderUpdates(data.id);
      } else {
        setLastOrder(null);
      }
    } catch (err) {
      console.error('Error fetching last order:', err);
    }
  }

  async function fetchProducts(customerOverride = null) {
    setLoadingMenu(true);

    try {
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .eq('is_active', true)
        .order('created_at', { ascending: true });

      if (error) {
        throw error;
      }

      const activeCustomer = customerOverride || customer;
      const isVip = Boolean(activeCustomer?.is_vip);

      // ستون قیمت در دیتابیس base_price و vip_price است.
      // برای اینکه بقیه کد برنامه ساده بماند، قیمت نهایی مشتری را
      // داخل فیلد مجازی price قرار می‌دهیم.
      const productList = (data || []).map(product => ({
        ...product,
        price: Number(
          isVip
            ? (product.vip_price ?? product.base_price ?? 0)
            : (product.base_price ?? 0)
        )
      }));

      setProducts(productList);

      const uniqueCategories = [
        'همه',
        ...new Set(
          productList
            .map(product => product.category)
            .filter(Boolean)
        )
      ];

      setCategories(uniqueCategories);
    } catch (err) {
      console.error('Error fetching products:', err);
    } finally {
      setLoadingMenu(false);
    }
  }

  const handleLoginSubmit = async (e) => {
    e.preventDefault();

    const phone = phoneInput.trim();

    if (!phone) {
      alert('لطفاً شماره موبایل معتبر وارد کنید.');
      return;
    }

    await checkCustomer(phone);
  };

  const handleRegisterSubmit = async (e) => {
    e.preventDefault();

    const fullName = regData.fullName.trim();
    const phone = regData.phone.trim();
    const shopName = regData.shopName.trim();
    const shopAddress = regData.shopAddress.trim();
    const addressNotes = regData.addressNotes.trim();

    if (!fullName || !phone || !shopName || !shopAddress) {
      alert('لطفاً تمام اطلاعات خواسته شده را تکمیل کنید.');
      return;
    }

    setSubmitting(true);

    try {
      const { data: existing, error: existingError } = await supabase
        .from('customers')
        .select('*')
        .eq('phone', phone)
        .maybeSingle();

      if (existingError) {
        throw existingError;
      }

      let customerData = existing;

      if (!existing) {
        const { data, error } = await supabase
          .from('customers')
          .insert([
            {
              phone,
              full_name: fullName,
              shop_name: shopName,
              shop_address: shopAddress,
              address_notes: addressNotes,
              is_vip: false,
              order_count: 0,
              total_spent: 0
            }
          ])
          .select()
          .single();

        if (error) {
          throw error;
        }

        customerData = data;
      }

      setCustomer(customerData);
      setAuthStep('app');

      localStorage.setItem('motopol_phone', phone);

      await fetchLastOrder(phone, customerData.id);
      await fetchProducts(customerData);
    } catch (e) {
      console.error('Registration error:', e);
      alert('خطا در ثبت‌نام: ' + (e.message || 'خطای نامشخص'));
    } finally {
      setSubmitting(false);
    }
  };

  const addToCart = (product) => {
    setCart(prev => {
      const index = prev.findIndex(
        item => item.id === product.id
      );

      if (index > -1) {
        const next = [...prev];

        next[index] = {
          ...next[index],
          quantity: next[index].quantity + 1
        };

        return next;
      }

      return [
        ...prev,
        {
          ...product,
          quantity: 1
        }
      ];
    });
  };

  const updateCartQuantity = (productId, quantity) => {
    setCart(prev => {
      if (quantity <= 0) {
        return prev.filter(item => item.id !== productId);
      }

      return prev.map(item =>
        item.id === productId
          ? {
              ...item,
              quantity
            }
          : item
      );
    });
  };

  const grandTotal = cart.reduce(
    (total, item) =>
      total + Number(item.price || 0) * item.quantity,
    0
  );

  const totalItemCount = cart.reduce(
    (total, item) => total + item.quantity,
    0
  );

  const isFreeDelivery = totalItemCount >= 2;
  const deliveryFee = isFreeDelivery ? 0 : 15000;
  const payableTotal = grandTotal + deliveryFee;

  const handlePlaceOrder = async () => {
    if (!customer) {
      alert('ابتدا وارد حساب کاربری شوید.');
      return;
    }

    if (cart.length === 0) {
      alert('سبد خرید شما خالی است.');
      return;
    }

    setSubmitting(true);

    try {
      // فقط شناسه محصول و تعداد را به دیتابیس می‌فرستیم.
      // قیمت، جمع سفارش و هزینه ارسال در PostgreSQL محاسبه می‌شود.
      const orderItems = cart.map(item => ({
        product_id: item.id,
        quantity: Number(item.quantity || 1)
      }));

      const { data: rpcData, error: rpcError } = await supabase.rpc(
        'create_order',
        {
          p_customer_id: customer.id,
          p_items: orderItems,
          p_payment_method: 'cash',
          p_customer_note: null
        }
      );

      if (rpcError) {
        throw rpcError;
      }

      if (!rpcData || !rpcData.order_id) {
        throw new Error('شناسه سفارش از سرور دریافت نشد.');
      }

      // سفارش ایجادشده را از دیتابیس می‌گیریم.
      const { data: createdOrder, error: orderFetchError } = await supabase
        .from('orders')
        .select('*')
        .eq('id', rpcData.order_id)
        .eq('customer_id', customer.id)
        .single();

      if (orderFetchError) {
        throw orderFetchError;
      }

      // اقلام واقعی سفارش را از دیتابیس می‌گیریم.
      const { data: createdItems, error: itemsFetchError } = await supabase
        .from('order_items')
        .select('*')
        .eq('order_id', rpcData.order_id)
        .order('created_at', { ascending: true });

      if (itemsFetchError) {
        throw itemsFetchError;
      }

      const fullOrder = {
        ...createdOrder,
        items: createdItems || []
      };

      // آمار مشتری را فقط بعد از موفقیت ثبت سفارش بروزرسانی می‌کنیم.
      const newOrderCount = Number(customer.order_count || 0) + 1;
      const newTotalSpent =
        Number(customer.total_spent || 0) +
        Number(createdOrder.final_amount || 0);

      const { data: updatedCustomer, error: customerError } = await supabase
        .from('customers')
        .update({
          order_count: newOrderCount,
          total_spent: newTotalSpent
        })
        .eq('id', customer.id)
        .select()
        .single();

      if (!customerError && updatedCustomer) {
        setCustomer(updatedCustomer);
      } else {
        console.warn(
          'آمار مشتری بروزرسانی نشد:',
          customerError
        );

        setCustomer(prev => ({
          ...prev,
          order_count: newOrderCount,
          total_spent: newTotalSpent
        }));
      }

      setLastOrder(fullOrder);
      setCart([]);
      setEditingOrder(false);
      setActiveTab('track');
      subscribeToOrderUpdates(createdOrder.id);
    } catch (e) {
      console.error('Order error:', e);
      alert(
        'خطا در ثبت سفارش: ' +
        (e?.message || 'خطای نامشخص')
      );
    } finally {
      setSubmitting(false);
    }
  };

  const getOrderEditableSeconds = order => {
    if (!order || order.status !== 'new' || !order.editable_until) return 0;
    return Math.max(0, Math.ceil((new Date(order.editable_until).getTime() - Date.now()) / 1000));
  };

  useEffect(() => {
    if (!lastOrder?.editable_until || lastOrder.status !== 'new') {
      setEditSecondsLeft(0);
      return;
    }

    const tick = () => {
      const seconds = getOrderEditableSeconds(lastOrder);
      setEditSecondsLeft(seconds);
      if (seconds <= 0 && editingOrder) {
        setEditingOrder(false);
        setCart([]);
      }
    };

    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [lastOrder, editingOrder]);

  const formatCountdown = seconds => {
    const min = Math.floor(seconds / 60);
    const sec = seconds % 60;
    return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  };

  const startEditOrder = async () => {
    const seconds = getOrderEditableSeconds(lastOrder);
    if (!lastOrder || lastOrder.status !== 'new' || seconds <= 0) {
      alert('مهلت ویرایش این سفارش به پایان رسیده است.');
      return;
    }

    try {
      const freshOrder = await fetchOrderWithItems(lastOrder.id);
      if (!freshOrder) throw new Error('سفارش پیدا نشد.');

      const freshSeconds = getOrderEditableSeconds(freshOrder);
      if (freshSeconds <= 0 || freshOrder.status !== 'new') {
        alert('مهلت ویرایش این سفارش به پایان رسیده است.');
        return;
      }

      const editableCart = (freshOrder.items || []).map(item => ({
        id: item.product_id,
        name: item.product_name,
        price: Number(item.unit_price || 0),
        quantity: Number(item.quantity || 1)
      }));

      setLastOrder(freshOrder);
      setCart(editableCart);
      setEditingOrder(true);
      setActiveTab('cart');
    } catch (e) {
      console.error('Edit order error:', e);
      alert('خطا در دریافت سفارش: ' + (e.message || 'خطای نامشخص'));
    }
  };

  const cancelEditOrder = () => {
    setEditingOrder(false);
    setCart([]);
    setActiveTab('track');
  };

  const handleUpdateOrder = async () => {
    if (!customer || !lastOrder) return;

    if (cart.length === 0) {
      alert('برای ویرایش، حداقل یک محصول انتخاب کنید.');
      return;
    }

    if (getOrderEditableSeconds(lastOrder) <= 0 || lastOrder.status !== 'new') {
      alert('مهلت ویرایش این سفارش به پایان رسیده است.');
      setEditingOrder(false);
      setCart([]);
      return;
    }

    setOrderEditSaving(true);

    try {
      const payload = cart.map(item => ({
        product_id: item.id,
        quantity: Number(item.quantity)
      }));

      const { data, error } = await supabase.rpc('update_order_from_cart', {
        p_order_id: lastOrder.id,
        p_customer_id: customer.id,
        p_items: payload
      });

      if (error) throw error;

      const updated = Array.isArray(data) ? data[0] : data;
      const fullOrder = await fetchOrderWithItems(lastOrder.id);

      setLastOrder(fullOrder || updated);
      setCart([]);
      setEditingOrder(false);
      setActiveTab('track');
      alert('سفارش با موفقیت ویرایش شد.');
    } catch (e) {
      console.error('Update order error:', e);
      alert('خطا در ویرایش سفارش: ' + (e.message || 'مهلت ویرایش تمام شده یا سفارش قابل ویرایش نیست.'));
    } finally {
      setOrderEditSaving(false);
    }
  };

  const startEditProfile = () => {
    setRegData({
      fullName: customer?.full_name || '',
      phone: customer?.phone || '',
      shopName: customer?.shop_name || '',
      shopAddress: customer?.shop_address || '',
      addressNotes: customer?.address_notes || ''
    });
    setEditingProfile(true);
  };

  const handleProfileEdit = async e => {
    e.preventDefault();
    if (!customer) return;

    const fullName = regData.fullName.trim();
    const shopName = regData.shopName.trim();
    const shopAddress = regData.shopAddress.trim();
    const addressNotes = regData.addressNotes.trim();

    if (!fullName || !shopName || !shopAddress) {
      alert('لطفاً نام، نام مغازه و آدرس را کامل کنید.');
      return;
    }

    setProfileSaving(true);
    try {
      const { data, error } = await supabase
        .from('customers')
        .update({
          full_name: fullName,
          shop_name: shopName,
          shop_address: shopAddress,
          address_notes: addressNotes || null
        })
        .eq('id', customer.id)
        .select()
        .single();

      if (error) throw error;
      setCustomer(data);
      setEditingProfile(false);
      alert('پروفایل با موفقیت بروزرسانی شد.');
    } catch (e) {
      console.error('Profile update error:', e);
      alert('خطا در بروزرسانی پروفایل: ' + (e.message || 'خطای نامشخص'));
    } finally {
      setProfileSaving(false);
    }
  };

  const subscribeToOrderUpdates = (orderId) => {
    if (!orderId) return;

    if (orderChannel.current) {
      supabase.removeChannel(orderChannel.current);
      orderChannel.current = null;
    }

    const channel = supabase
      .channel(`order_track_${orderId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'orders',
          filter: `id=eq.${orderId}`
        },
        async payload => {
          try {
            const fullOrder = await fetchOrderWithItems(payload.new.id);
            setLastOrder(fullOrder || payload.new);
          } catch (e) {
            console.error('Order realtime refresh error:', e);
            setLastOrder(payload.new);
          }
        }
      )
      .subscribe();

    orderChannel.current = channel;
  };

  const handleLogout = () => {
    localStorage.removeItem('motopol_phone');

    if (orderChannel.current) {
      supabase.removeChannel(orderChannel.current);
      orderChannel.current = null;
    }

    setCustomer(null);
    setLastOrder(null);
    setCart([]);
    setActiveCategory('همه');
    setActiveTab('menu');
    setAuthStep('login');
    setPhoneInput('');
    setRegData({
      fullName: '',
      phone: '',
      shopName: '',
      shopAddress: '',
      addressNotes: ''
    });
  };

  const filteredProducts =
    activeCategory === 'همه'
      ? products
      : products.filter(
          product => product.category === activeCategory
        );

  const currentStepIdx = lastOrder ? STEPS.findIndex(step => step.key === lastOrder.status) : -1;

  return (
    <div className="app">
      <Head>
        <title>موتوپل | سفارش سریع قهوه</title>
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1.0"
        />
      </Head>

      <style jsx global>{`
        * {
          box-sizing: border-box;
          margin: 0;
          padding: 0;
        }

        html,
        body {
          margin: 0;
          padding: 0;
          background-color: #0b0f19;
        }

        body {
          color: #f8fafc;
          font-family:
            Vazirmatn,
            -apple-system,
            BlinkMacSystemFont,
            "Segoe UI",
            Tahoma,
            sans-serif;
          direction: rtl;
        }

        input,
        button,
        textarea {
          font-family: inherit;
        }

        button {
          -webkit-tap-highlight-color: transparent;
        }
      `}</style>

      <style jsx>{`
        .app {
          min-height: 100vh;
          max-width: 500px;
          margin: 0 auto;
          background-color: #0f172a;
          padding-bottom: 30px;
        }

        .center-screen {
          min-height: 100vh;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          text-align: center;
          padding: 20px;
        }

        .brand-title {
          font-size: 28px;
          font-weight: 800;
          color: #f59e0b;
          margin-bottom: 8px;
        }

        .brand-sub {
          color: #94a3b8;
          margin-bottom: 24px;
          font-size: 15px;
        }

        .auth-form {
          width: 100%;
          max-width: 340px;
        }

        .input {
          width: 100%;
          padding: 14px;
          border-radius: 10px;
          background-color: #1e293b;
          border: 1px solid #334155;
          color: #fff;
          font-size: 15px;
          margin-bottom: 10px;
          outline: none;
        }

        .input:focus {
          border-color: #f59e0b;
        }

        .btn-gold {
          width: 100%;
          background: linear-gradient(
            135deg,
            #f59e0b 0%,
            #d97706 100%
          );
          color: #0f172a;
          font-weight: 700;
          border: none;
          border-radius: 12px;
          cursor: pointer;
          padding: 14px;
          font-size: 16px;
          margin-top: 6px;
        }

        .btn-gold:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .auth-switch {
          color: #94a3b8;
          margin-top: 20px;
          font-size: 14px;
        }

        .auth-switch button {
          color: #f59e0b;
          font-weight: 600;
          background: none;
          border: none;
          cursor: pointer;
          text-decoration: underline;
          font-size: 14px;
        }

        .page {
          padding: 16px;
          padding-top: 24px;
        }

        .page-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 20px;
        }

        .page-title {
          font-size: 20px;
          font-weight: 700;
        }

        .cancel-link {
          color: #f87171;
          background: none;
          border: none;
          font-size: 13px;
          cursor: pointer;
        }

        .topbar {
          position: sticky;
          top: 0;
          z-index: 10;
          background-color: #0f172a;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 10px 14px;
          border-bottom: 1px solid #1e293b;
        }

        .tabs {
          display: flex;
          gap: 4px;
          overflow-x: auto;
        }

        .tab-btn {
          padding: 8px 10px;
          background: none;
          border: none;
          color: #94a3b8;
          font-size: 14px;
          cursor: pointer;
          border-bottom: 2px solid transparent;
          white-space: nowrap;
        }

        .tab-btn.active {
          color: #f59e0b;
          border-bottom-color: #f59e0b;
          font-weight: 700;
        }

        .logout-btn {
          color: #f87171;
          background: none;
          border: none;
          font-size: 12px;
          cursor: pointer;
          white-space: nowrap;
          margin-right: 8px;
        }

        .chips {
          display: flex;
          gap: 8px;
          overflow-x: auto;
          margin-bottom: 16px;
          padding-bottom: 4px;
        }

        .chip {
          flex-shrink: 0;
          padding: 8px 16px;
          border-radius: 999px;
          background: #1e293b;
          border: 1px solid #334155;
          color: #94a3b8;
          font-size: 14px;
          cursor: pointer;
        }

        .chip.active {
          background: #f59e0b;
          color: #0f172a;
          border-color: #f59e0b;
          font-weight: 700;
        }

        .card {
          background: #1e293b;
          border: 1px solid #334155;
          border-radius: 16px;
          padding: 16px;
          margin-bottom: 12px;
        }

        .product-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
        }

        .product-name {
          font-weight: 700;
          font-size: 16px;
          margin-bottom: 4px;
        }

        .product-desc {
          color: #94a3b8;
          font-size: 12px;
          margin-bottom: 8px;
          line-height: 1.7;
        }

        .product-price {
          color: #fbbf24;
          font-weight: 700;
          font-size: 14px;
        }

        .buy-btn {
          background: #22c55e;
          color: #fff;
          border: none;
          padding: 10px 16px;
          border-radius: 10px;
          cursor: pointer;
          font-weight: 700;
          font-size: 14px;
          flex-shrink: 0;
        }

        .empty {
          text-align: center;
          color: #64748b;
          padding: 40px 10px;
          font-size: 15px;
        }

        .qty-box {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .qty-btn {
          background: #334155;
          color: #fff;
          border: none;
          width: 32px;
          height: 32px;
          border-radius: 8px;
          font-size: 16px;
          cursor: pointer;
          font-weight: 700;
        }

        .cart-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 10px;
        }

        .cart-item-name {
          font-weight: 700;
          margin-bottom: 4px;
          font-size: 15px;
        }

        .cart-item-meta {
          color: #94a3b8;
          font-size: 12px;
        }

        .summary-row {
          display: flex;
          justify-content: space-between;
          gap: 10px;
          font-size: 14px;
          color: #cbd5e1;
          margin-bottom: 8px;
        }

        .total-row {
          display: flex;
          justify-content: space-between;
          gap: 10px;
          font-weight: 800;
          font-size: 17px;
          border-top: 1px solid #334155;
          padding-top: 12px;
          margin-top: 4px;
        }

        .total-row span:last-child {
          color: #fbbf24;
        }

        .track-head {
          display: flex;
          justify-content: space-between;
          align-items: center;
          border-bottom: 1px solid #334155;
          padding-bottom: 12px;
          margin-bottom: 16px;
          gap: 10px;
        }

        .track-code {
          font-family: monospace;
          font-weight: 700;
        }

        .status-badge {
          background: rgba(245, 158, 11, 0.15);
          color: #fbbf24;
          padding: 6px 12px;
          border-radius: 999px;
          font-size: 12px;
          font-weight: 700;
          white-space: nowrap;
        }

        .steps {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 8px;
          text-align: center;
          margin: 20px 0;
        }

        .step {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 6px;
          opacity: 0.3;
        }

        .step.done {
          opacity: 1;
        }

        .step-icon {
          width: 42px;
          height: 42px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #1e293b;
          font-size: 18px;
        }

        .step.done .step-icon {
          background: #f59e0b;
        }

        .step-label {
          font-size: 11px;
          font-weight: 600;
        }

        .items-title {
          font-size: 12px;
          color: #94a3b8;
          margin-bottom: 8px;
        }

        .item-row {
          display: flex;
          justify-content: space-between;
          gap: 10px;
          font-size: 14px;
          padding: 4px 0;
        }

        .profile-row {
          margin-bottom: 10px;
          font-size: 15px;
          line-height: 1.7;
        }

        .profile-row span {
          color: #94a3b8;
        }

        .stats {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
          background: rgba(15, 23, 42, 0.6);
          padding: 16px;
          border-radius: 14px;
          text-align: center;
          margin-top: 16px;
        }

        .stat-label {
          font-size: 12px;
          color: #94a3b8;
          margin-bottom: 4px;
        }

        .stat-value {
          font-size: 18px;
          font-weight: 800;
          color: #fbbf24;
        }


        .edit-order-banner {
          background: rgba(245, 158, 11, 0.12);
          border: 1px solid rgba(245, 158, 11, 0.35);
          color: #fbbf24;
          border-radius: 14px;
          padding: 12px;
          margin-bottom: 14px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 10px;
          font-size: 12px;
        }

        .edit-order-banner span { color: #cbd5e1; }

        .edit-order-banner button,
        .cancel-edit-btn {
          border: 1px solid #475569;
          background: #1e293b;
          color: #fff;
          border-radius: 10px;
          padding: 10px 12px;
          cursor: pointer;
          font-weight: 700;
        }

        .edit-cart-actions {
          display: grid;
          gap: 8px;
        }

        .cancel-edit-btn {
          width: 100%;
          margin-top: 8px;
        }

        @media (max-width: 380px) {
          .tab-btn {
            padding: 8px 7px;
            font-size: 12px;
          }

          .logout-btn {
            font-size: 11px;
          }

          .product-row {
            align-items: flex-start;
          }

          .buy-btn {
            padding: 9px 11px;
          }

          .step-label {
            font-size: 9px;
          }
        }
      `}</style>

      {/* LOGIN */}
      {(authStep === 'login' || authStep === 'checking') && (
        <div className="center-screen">
          <h1 className="brand-title">
            موتوپل ☕
          </h1>

          <p className="brand-sub">
            سفارش سریع قهوه به محل کار شما
          </p>

          <form
            onSubmit={handleLoginSubmit}
            className="auth-form"
          >
            <input
              type="tel"
              className="input"
              placeholder="شماره موبایل (مثال: 09121234567)"
              value={phoneInput}
              onChange={e =>
                setPhoneInput(e.target.value)
              }
              required
            />

            <button
              type="submit"
              className="btn-gold"
              disabled={
                submitting ||
                authStep === 'checking'
              }
            >
              {authStep === 'checking'
                ? 'در حال بررسی...'
                : 'ورود و مشاهده منو 🚀'}
            </button>
          </form>

          <p className="auth-switch">
            حساب کاربری ندارید؟{' '}
            <button
              type="button"
              onClick={() => {
                setRegData(prev => ({
                  ...prev,
                  phone: phoneInput.trim()
                }));

                setAuthStep('register');
              }}
            >
              ثبت‌نام کنید
            </button>
          </p>
        </div>
      )}

      {/* REGISTER */}
      {authStep === 'register' && (
        <div className="page">
          <div className="page-header">
            <h2 className="page-title">
              ثبت عضویت در موتوپل ✨
            </h2>

            <button
              type="button"
              onClick={handleLogout}
              className="cancel-link"
            >
              لغو
            </button>
          </div>

          <form onSubmit={handleRegisterSubmit}>
            <input
              className="input"
              type="text"
              placeholder="نام و نام خانوادگی"
              value={regData.fullName}
              onChange={e =>
                setRegData({
                  ...regData,
                  fullName: e.target.value
                })
              }
              required
            />

            <input
              className="input"
              type="tel"
              placeholder="شماره موبایل"
              value={regData.phone}
              onChange={e =>
                setRegData({
                  ...regData,
                  phone: e.target.value
                })
              }
              required
            />

            <input
              className="input"
              type="text"
              placeholder="نام مغازه / فروشگاه"
              value={regData.shopName}
              onChange={e =>
                setRegData({
                  ...regData,
                  shopName: e.target.value
                })
              }
              required
            />

            <input
              className="input"
              type="text"
              placeholder="آدرس دقیق"
              value={regData.shopAddress}
              onChange={e =>
                setRegData({
                  ...regData,
                  shopAddress: e.target.value
                })
              }
              required
            />

            <input
              className="input"
              type="text"
              placeholder="توضیحات تحویل (اختیاری)"
              value={regData.addressNotes}
              onChange={e =>
                setRegData({
                  ...regData,
                  addressNotes: e.target.value
                })
              }
            />

            <button
              type="submit"
              className="btn-gold"
              disabled={submitting}
            >
              {submitting
                ? 'در حال ثبت...'
                : 'ثبت و ورود'}
            </button>
          </form>
        </div>
      )}

      {/* APP */}
      {authStep === 'app' && customer && (
        <div>
          <div className="topbar">
            <div className="tabs">
              <button
                type="button"
                onClick={() => setActiveTab('menu')}
                className={`tab-btn ${
                  activeTab === 'menu'
                    ? 'active'
                    : ''
                }`}
              >
                منو
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('cart')}
                className={`tab-btn ${
                  activeTab === 'cart'
                    ? 'active'
                    : ''
                }`}
              >
                سبد ({totalItemCount})
              </button>

              <button
                type="button"
                onClick={() =>
                  setActiveTab('track')
                }
                className={`tab-btn ${
                  activeTab === 'track'
                    ? 'active'
                    : ''
                }`}
              >
                پیگیری
              </button>

              <button
                type="button"
                onClick={() =>
                  setActiveTab('profile')
                }
                className={`tab-btn ${
                  activeTab === 'profile'
                    ? 'active'
                    : ''
                }`}
              >
                پروفایل
              </button>
            </div>

            <button
              type="button"
              onClick={handleLogout}
              className="logout-btn"
            >
              خروج
            </button>
          </div>

          <div className="page">
            {/* MENU */}
            {activeTab === 'menu' && (
              <div>
                <div className="chips">
                  {categories.map(cat => (
                    <button
                      type="button"
                      key={cat}
                      onClick={() =>
                        setActiveCategory(cat)
                      }
                      className={`chip ${
                        activeCategory === cat
                          ? 'active'
                          : ''
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>

                {loadingMenu ? (
                  <p className="empty">
                    در حال دریافت منو...
                  </p>
                ) : filteredProducts.length === 0 ? (
                  <p className="empty">
                    محصولی در این دسته یافت نشد.
                  </p>
                ) : (
                  filteredProducts.map(product => {
                    const inCart =
                      cart.find(
                        item =>
                          item.id === product.id
                      )?.quantity || 0;

                    return (
                      <div
                        key={product.id}
                        className="card product-row"
                      >
                        <div>
                          <h3 className="product-name">
                            {product.name}
                          </h3>

                          {product.description && (
                            <p className="product-desc">
                              {product.description}
                            </p>
                          )}

                          <span className="product-price">
                            {Number(
                              product.price || 0
                            ).toLocaleString('fa-IR')}{' '}
                            تومان
                          </span>
                        </div>

                        <button
                          type="button"
                          onClick={() =>
                            addToCart(product)
                          }
                          className="buy-btn"
                        >
                          {inCart === 0
                            ? '+ افزودن'
                            : `${inCart} عدد`}
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            )}

            {/* CART */}
            {activeTab === 'cart' && (
              <div>
                <div className="page-header">
                  <h2 className="page-title">
                    سبد خرید شما
                  </h2>
                </div>

                {cart.length === 0 ? (
                  <p className="empty">
                    سبد خرید شما خالی است ☕
                  </p>
                ) : (
                  <>
                    {cart.map(item => (
                      <div
                        key={item.id}
                        className="card cart-row"
                      >
                        <div>
                          <h3 className="cart-item-name">
                            {item.name}
                          </h3>

                          <p className="cart-item-meta">
                            {item.quantity} ×{' '}
                            {Number(
                              item.price || 0
                            ).toLocaleString('fa-IR')}{' '}
                            تومان
                          </p>
                        </div>

                        <div className="qty-box">
                          <button
                            type="button"
                            className="qty-btn"
                            onClick={() =>
                              updateCartQuantity(
                                item.id,
                                item.quantity - 1
                              )
                            }
                          >
                            −
                          </button>

                          <span
                            style={{
                              fontWeight: 700
                            }}
                          >
                            {item.quantity}
                          </span>

                          <button
                            type="button"
                            className="qty-btn"
                            onClick={() =>
                              updateCartQuantity(
                                item.id,
                                item.quantity + 1
                              )
                            }
                          >
                            +
                          </button>
                        </div>
                      </div>
                    ))}

                    <div className="card">
                      <div className="summary-row">
                        <span>جمع محصولات:</span>

                        <span>
                          {grandTotal.toLocaleString(
                            'fa-IR'
                          )}{' '}
                          تومان
                        </span>
                      </div>

                      <div className="summary-row">
                        <span>هزینه ارسال:</span>

                        <span>
                          {isFreeDelivery
                            ? 'رایگان (۲+ آیتم) 🎉'
                            : `${deliveryFee.toLocaleString(
                                'fa-IR'
                              )} تومان`}
                        </span>
                      </div>

                      <div className="total-row">
                        <span>
                          مبلغ قابل پرداخت:
                        </span>

                        <span>
                          {payableTotal.toLocaleString(
                            'fa-IR'
                          )}{' '}
                          تومان
                        </span>
                      </div>

                      {editingOrder && (
                        <div className="edit-cart-actions">
                          <button
                            type="button"
                            onClick={handleUpdateOrder}
                            className="btn-gold"
                            disabled={orderEditSaving}
                          >
                            {orderEditSaving ? 'در حال ذخیره...' : 'ذخیره تغییرات سفارش'}
                          </button>
                          <button
                            type="button"
                            onClick={cancelEditOrder}
                            className="cancel-edit-btn"
                            disabled={orderEditSaving}
                          >
                            انصراف
                          </button>
                        </div>
                      )}

                      {!editingOrder && (
                        <button
                          type="button"
                          onClick={handlePlaceOrder}
                          className="btn-gold"
                          disabled={submitting}
                        >
                          {submitting ? 'در حال ثبت سفارش...' : 'ثبت سفارش نهایی'}
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}

            {/* TRACK */}
            {activeTab === 'track' && (
              <div>
                <div className="page-header">
                  <h2 className="page-title">
                    وضعیت آخرین سفارش
                  </h2>
                </div>

                {lastOrder && lastOrder.status === 'new' && editSecondsLeft > 0 && (
                  <div className="edit-order-banner">
                    <div>
                      <strong>✏️ امکان ویرایش سفارش</strong>
                      <span> تا {formatCountdown(editSecondsLeft)} فرصت دارید.</span>
                    </div>
                    <button type="button" onClick={startEditOrder}>ویرایش سفارش</button>
                  </div>
                )}

                {!lastOrder ? (
                  <div className="empty">
                    <p>
                      هنوز هیچ سفارشی ثبت نکرده‌اید ☕
                    </p>

                    <button
                      type="button"
                      onClick={() =>
                        setActiveTab('menu')
                      }
                      className="btn-gold"
                      style={{
                        maxWidth: 240,
                        margin:
                          '16px auto 0'
                      }}
                    >
                      مشاهده منو و ثبت سفارش
                    </button>
                  </div>
                ) : (
                  <div className="card">
                    <div className="track-head">
                      <div>
                        <p
                          style={{
                            fontSize: 12,
                            color: '#94a3b8',
                            marginBottom: 4
                          }}
                        >
                          کد پیگیری:
                        </p>

                        <p className="track-code">
                          #
                          {String(
                            lastOrder.id
                          ).slice(0, 8)}
                        </p>
                      </div>

                      <span className="status-badge">
                        {STEPS.find(
                          step =>
                            step.key ===
                            lastOrder.status
                        )?.label ||
                          lastOrder.status}
                      </span>
                    </div>

                    <div className="steps">
                      {STEPS.map(
                        (step, idx) => (
                          <div
                            key={step.key}
                            className={`step ${
                              idx <=
                              currentStepIdx
                                ? 'done'
                                : ''
                            }`}
                          >
                            <div className="step-icon">
                              {step.icon}
                            </div>

                            <span className="step-label">
                              {step.label}
                            </span>
                          </div>
                        )
                      )}
                    </div>

                    <div
                      style={{
                        borderTop:
                          '1px solid #334155',
                        paddingTop: 12,
                        marginTop: 12
                      }}
                    >
                      <p className="items-title">
                        اقلام سفارش:
                      </p>

                      {Array.isArray(lastOrder.items) && lastOrder.items.map((item, index) => (
                        <div key={item.id || index} className="item-row">
                          <span>{item.product_name} × {item.quantity}</span>
                          <span>{Number(item.total_price || 0).toLocaleString('fa-IR')} تومان</span>
                        </div>
                      ))}

                      <div
                        className="summary-row"
                        style={{
                          marginTop: 10
                        }}
                      >
                        <span>
                          هزینه ارسال:
                        </span>

                        <span>
                          {Number(
                            lastOrder.delivery_fee ||
                              0
                          ) === 0
                            ? 'رایگان 🎉'
                            : `${Number(
                                lastOrder.delivery_fee
                              ).toLocaleString(
                                'fa-IR'
                              )} تومان`}
                        </span>
                      </div>

                      <div className="total-row">
                        <span>
                          مبلغ قابل پرداخت:
                        </span>

                        <span>
                          {Number(lastOrder.final_amount || 0).toLocaleString(
                            'fa-IR'
                          )}{' '}
                          تومان
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* PROFILE */}
            {activeTab === 'profile' && (
              <div>
                <div className="page-header">
                  <h2 className="page-title">
                    پروفایل کاربر
                  </h2>
                </div>

                <div className="card">
                  {!editingProfile ? (
                    <>
                      <p className="profile-row"><span>نام: </span>{customer.full_name}</p>
                      <p className="profile-row"><span>مغازه: </span>{customer.shop_name}</p>
                      <p className="profile-row"><span>موبایل: </span>{customer.phone}</p>
                      <p className="profile-row"><span>آدرس: </span>{customer.shop_address}</p>
                      {customer.address_notes && (
                        <p className="profile-row"><span>توضیحات تحویل: </span>{customer.address_notes}</p>
                      )}

                      <button type="button" className="btn-gold" onClick={startEditProfile}>
                        ویرایش پروفایل
                      </button>

                      <div className="stats">
                        <div>
                          <p className="stat-label">تعداد سفارش‌ها</p>
                          <p className="stat-value">{customer.order_count || 0}</p>
                        </div>
                        <div>
                          <p className="stat-label">مجموع خرید</p>
                          <p className="stat-value">
                            {Number(customer.total_spent || 0).toLocaleString('fa-IR')} تومان
                          </p>
                        </div>
                      </div>
                    </>
                  ) : (
                    <form onSubmit={handleProfileEdit}>
                      <input className="input" value={regData.fullName} onChange={e => setRegData(prev => ({ ...prev, fullName: e.target.value }))} placeholder="نام و نام خانوادگی" required />
                      <input className="input" value={regData.phone} disabled type="tel" placeholder="شماره موبایل" />
                      <input className="input" value={regData.shopName} onChange={e => setRegData(prev => ({ ...prev, shopName: e.target.value }))} placeholder="نام مغازه / فروشگاه" required />
                      <input className="input" value={regData.shopAddress} onChange={e => setRegData(prev => ({ ...prev, shopAddress: e.target.value }))} placeholder="آدرس دقیق" required />
                      <input className="input" value={regData.addressNotes} onChange={e => setRegData(prev => ({ ...prev, addressNotes: e.target.value }))} placeholder="توضیحات تحویل (اختیاری)" />
                      <button type="submit" className="btn-gold" disabled={profileSaving}>
                        {profileSaving ? 'در حال ذخیره...' : 'ذخیره پروفایل'}
                      </button>
                      <button type="button" className="cancel-edit-btn" onClick={() => setEditingProfile(false)} disabled={profileSaving}>
                        انصراف
                      </button>
                    </form>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
