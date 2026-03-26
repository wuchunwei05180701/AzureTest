import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Input, Button, message, Typography } from 'antd';
import { MailOutlined, LockOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { authAPI } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import './Login.css';

const { Title, Text, Link } = Typography;

const Login = () => {
  const navigate = useNavigate();
  const { login, isAuthenticated } = useAuth();
  // Login 頁面在使用者未登入時，LanguageContext 可能尚未有 user.country
  // 此時會使用預設語言 (zh-TW)，登入後會自動切換
  let t;
  try {
    const lang = useLanguage();
    t = lang.t;
  } catch {
    // fallback: 如果 LanguageContext 不可用，使用 key 本身
    t = (key) => key;
  }

  const [step, setStep] = useState(1); // 1: 輸入 Email, 2: 輸入 OTP
  const [email, setEmail] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [detail, setDetail] = useState('');

  // 如果已登入，跳轉到首頁
  useEffect(() => {
    if (isAuthenticated) {
      navigate('/', { replace: true });
    }
  }, [isAuthenticated, navigate]);

  // 倒數計時器
  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setInterval(() => {
      setCountdown((prev) => prev - 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [countdown]);

  // 通用錯誤訊息提取（處理 FastAPI 422 validation error 的陣列格式 detail）
  const extractErrorMsg = (error, fallback) => {
    const detail = error.response?.data?.detail;
    if (typeof detail === 'string') return detail;
    if (Array.isArray(detail) && detail.length > 0) {
      // FastAPI validation error: [{type, loc, msg, input}, ...]
      return detail.map(e => e.msg || JSON.stringify(e)).join('; ');
    }
    return fallback;
  };

  // Step 1: 取得驗證碼
  const handleRequestOTP = useCallback(async () => {
    if (!email || !email.trim()) {
      message.warning(t('login.emailRequired'));
      return;
    }

    // 簡單的 email 格式驗證
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      message.warning(t('login.emailInvalid'));
      return;
    }

    setLoading(true);
    try {
      const response = await authAPI.requestOTP(email.trim());
      message.success(response.data.message || t('login.otpSentSuccess'));
      setDetail(response.data.detail || '');
      setStep(2);
      setCountdown(60);
      // 開發模式：後端回傳 dev_otp 時自動填入
      if (response.data.dev_otp) {
        setOtpCode(response.data.dev_otp);
        message.info(`[DEV] OTP 已自動填入: ${response.data.dev_otp}`, 5);
      } else {
        setOtpCode('');
      }
    } catch (error) {
      const errorMsg = extractErrorMsg(error, t('login.sendFailed'));
      message.error(errorMsg);
    } finally {
      setLoading(false);
    }
  }, [email, t]);

  // Step 2: 驗證 OTP 並登入
  const handleVerifyOTP = useCallback(async () => {
    if (!otpCode || otpCode.trim().length < 6) {
      message.warning(t('login.otpRequired'));
      return;
    }

    setLoading(true);
    try {
      const response = await authAPI.verifyOTP(email.trim(), otpCode.trim());
      const { access_token, user } = response.data;

      // 儲存 token 並更新 AuthContext
      login(access_token, user);
      message.success(t('login.loginSuccess'));
      navigate('/', { replace: true });
    } catch (error) {
      const errorMsg = extractErrorMsg(error, t('login.otpError'));
      message.error(errorMsg);
    } finally {
      setLoading(false);
    }
  }, [email, otpCode, login, navigate, t]);

  // 重新發送驗證碼
  const handleResendOTP = useCallback(async () => {
    if (countdown > 0) return;

    setLoading(true);
    try {
      const response = await authAPI.requestOTP(email.trim());
      message.success(response.data.message || t('login.otpResent'));
      setDetail(response.data.detail || '');
      setCountdown(60);
      // 開發模式：後端回傳 dev_otp 時自動填入
      if (response.data.dev_otp) {
        setOtpCode(response.data.dev_otp);
        message.info(`[DEV] OTP 已自動填入: ${response.data.dev_otp}`, 5);
      } else {
        setOtpCode('');
      }
    } catch (error) {
      const errorMsg = extractErrorMsg(error, t('login.resendFailed'));
      message.error(errorMsg);
    } finally {
      setLoading(false);
    }
  }, [email, countdown, t]);

  // 返回 Step 1
  const handleBackToEmail = () => {
    setStep(1);
    setOtpCode('');
    setCountdown(0);
    setDetail('');
  };

  // 遮蔽 email 顯示
  const maskedEmail = email
    ? email.replace(/^(.{2})(.*)(@.*)$/, (_, a, b, c) => a + '*'.repeat(b.length) + c)
    : '';

  return (
    <div className="login-page">
      <div className="login-card">
        {/* Logo 區域 */}
        <div className="login-header">
          <div className="login-logo">
            <SafetyCertificateOutlined className="login-logo-icon" />
          </div>
          <Title level={3} className="login-title">
            {t('login.title')}
          </Title>
          <Text className="login-subtitle">{t('login.subtitle')}</Text>
        </div>

        {/* Step 1: 輸入 Email */}
        {step === 1 && (
          <div className="login-form">
            <div className="login-field">
              <label className="login-label">{t('login.emailLabel')}</label>
              <Input
                size="large"
                placeholder={t('login.emailPlaceholder')}
                prefix={<MailOutlined style={{ color: '#bbb' }} />}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onPressEnter={handleRequestOTP}
                autoFocus
              />
            </div>
            <Button
              type="primary"
              size="large"
              block
              loading={loading}
              onClick={handleRequestOTP}
              className="login-btn"
            >
              {t('login.getOTP')}
            </Button>
          </div>
        )}

        {/* Step 2: 輸入 OTP */}
        {step === 2 && (
          <div className="login-form">
            <div className="login-otp-info">
              <Text type="secondary">
                {t('login.otpSentTo')} <strong>{maskedEmail}</strong>
              </Text>
            </div>
            <div className="login-field">
              <label className="login-label">{t('login.otpLabel')}</label>
              <Input
                size="large"
                placeholder={t('login.otpPlaceholder')}
                prefix={<LockOutlined style={{ color: '#bbb' }} />}
                value={otpCode}
                onChange={(e) => {
                  // 只允許數字，最多 6 位
                  const val = e.target.value.replace(/\D/g, '').slice(0, 6);
                  setOtpCode(val);
                }}
                onPressEnter={handleVerifyOTP}
                maxLength={6}
                autoFocus
              />
            </div>
            <Button
              type="primary"
              size="large"
              block
              loading={loading}
              onClick={handleVerifyOTP}
              className="login-btn"
              disabled={otpCode.length < 6}
            >
              {t('login.loginBtn')}
            </Button>
            <div className="login-actions">
              <Link
                onClick={handleResendOTP}
                disabled={countdown > 0}
                className="login-resend"
              >
                {countdown > 0
                  ? t('login.resendCountdown', { seconds: countdown })
                  : t('login.resendOTP')}
              </Link>
              <Link onClick={handleBackToEmail} className="login-back">
                {t('common.back')}
              </Link>
            </div>
          </div>
        )}

        {/* 開發模式提示 */}
        <div className="login-dev-hint">
          <Text type="secondary" style={{ fontSize: 12 }}>
            {t('login.devHint')}
          </Text>
          {detail && (
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 4 }}>
              Detail: {detail}
            </Text>
          )}
        </div>
      </div>
    </div>
  );
};

export default Login;
