import {
  LayoutDashboard, Rocket, Store, Link2, Wallet, User, Users, Building2,
  Inbox, Scale, BarChart3, TrendingUp, MousePointerClick, Target, Copy,
  Check, X, AlertTriangle, Lock, Search, Tag, Sparkles, ShieldCheck,
  CreditCard, Bell, MessageSquare, Camera, Megaphone, PartyPopper,
  Palette, Handshake, Mail, KeyRound, Smartphone, MapPin, FileText,
  Hand, Dumbbell, Music2, AtSign, Video, Package, Plus, Minus,
  ArrowUpRight, ArrowDownRight, ChevronRight, Eye, Clock, DollarSign,
  Percent, Award, Zap, Heart, Globe, Settings, LogOut, Menu, Trash2,
  Shirt, Footprints, Sparkle, Coffee, Utensils, Laptop, Plane, Gamepad2,
  Leaf, BookOpen, Baby, PawPrint, Home, Pill, CupSoda, Watch,
} from 'lucide-react'

// Single source of truth for iconography. Components reference semantic names
// rather than importing lucide directly, so a change of icon set — or a single
// icon — happens in one place instead of across two dozen files.
const REGISTRY = {
  // navigation
  overview:      LayoutDashboard,
  campaigns:     Rocket,
  storefront:    Store,
  links:         Link2,
  earnings:      Wallet,
  profile:       User,
  creators:      Users,
  brands:        Building2,
  applications:  Inbox,
  payouts:       Wallet,
  disputes:      Scale,
  payments:      CreditCard,

  // metrics
  analytics:     BarChart3,
  trending:      TrendingUp,
  clicks:        MousePointerClick,
  target:        Target,
  percent:       Percent,
  money:         DollarSign,
  score:         Award,
  views:         Eye,
  clock:         Clock,

  // actions
  copy:          Copy,
  check:         Check,
  close:         X,
  add:           Plus,
  remove:        Minus,
  trash:         Trash2,
  search:        Search,
  settings:      Settings,
  logout:        LogOut,
  menu:          Menu,
  next:          ChevronRight,
  up:            ArrowUpRight,
  down:          ArrowDownRight,

  // status & meaning
  warning:       AlertTriangle,
  lock:          Lock,
  shield:        ShieldCheck,
  verified:      ShieldCheck,
  sparkle:       Sparkles,
  celebrate:     PartyPopper,
  bell:          Bell,
  message:       MessageSquare,
  mail:          Mail,
  key:           KeyRound,
  wave:          Hand,
  handshake:     Handshake,
  megaphone:     Megaphone,
  camera:        Camera,
  tag:           Tag,
  package:       Package,
  document:      FileText,
  location:      MapPin,
  phone:         Smartphone,
  globe:         Globe,
  heart:         Heart,
  zap:           Zap,
  palette:       Palette,

  // social — lucide dropped brand logos over trademark concerns, so these are
  // generic stand-ins. If the client wants real platform marks later, they
  // need to come from the platforms' own brand assets.
  instagram:     AtSign,
  youtube:       Video,
  tiktok:        Music2,

  // niches (creator categories)
  fitness:       Dumbbell,
  wellness:      Sparkle,
  fashion:       Shirt,
  footwear:      Footprints,
  beauty:        Sparkles,
  food:          Utensils,
  drink:         CupSoda,
  coffee:        Coffee,
  tech:          Laptop,
  travel:        Plane,
  gaming:        Gamepad2,
  nature:        Leaf,
  books:         BookOpen,
  parenting:     Baby,
  pets:          PawPrint,
  home:          Home,
  health:        Pill,
  accessories:   Watch,
}

export default function Icon({ name, size = 18, strokeWidth = 1.75, className, style, ...rest }) {
  const Glyph = REGISTRY[name]
  if (!Glyph) {
    // Loud in development, invisible in production — a typo should be obvious
    // while building but must never break a customer's dashboard.
    if (import.meta.env.DEV) console.warn(`<Icon> unknown name: "${name}"`)
    return null
  }
  return (
    <Glyph
      size={size}
      strokeWidth={strokeWidth}
      className={className}
      style={{ flexShrink: 0, ...style }}
      aria-hidden="true"
      {...rest}
    />
  )
}

export { REGISTRY }
