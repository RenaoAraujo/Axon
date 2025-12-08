from typing import Dict, Optional, Tuple

# Fatores de conversão para metros (m) como unidade base
_LENGTH_TO_METERS: Dict[str, float] = {
	"mm": 1e-3,              # milímetro
	"cm": 1e-2,              # centímetro
	"m": 1.0,                # metro
	"km": 1e3,               # quilômetro
	"in": 0.0254,            # polegada (inch)
	"ft": 0.3048,            # pé (foot)
	"yd": 0.9144,            # jarda (yard)
	"mi": 1609.344,          # milha (statute mile)
	"nm": 1852.0,            # milha náutica (nautical mile)
}

# Apelidos comuns (pt/en) → unidade canônica
_ALIASES: Dict[str, str] = {
	"millimeter": "mm", "millimeters": "mm", "milimetro": "mm", "milímetro": "mm", "mm": "mm",
	"centimeter": "cm", "centimeters": "cm", "centimetro": "cm", "centímetro": "cm", "cm": "cm",
	"meter": "m", "metros": "m", "metro": "m", "m": "m",
	"kilometer": "km", "kilometers": "km", "quilometro": "km", "quilômetro": "km", "km": "km",
	"inch": "in", "inches": "in", "polegada": "in", "polegadas": "in", "in": "in",
	"foot": "ft", "feet": "ft", "pé": "ft", "pes": "ft", "pés": "ft", "ft": "ft",
	"yard": "yd", "yards": "yd", "jarda": "yd", "jardas": "yd", "yd": "yd",
	"mile": "mi", "miles": "mi", "milha": "mi", "milhas": "mi", "mi": "mi",
	"nauticalmile": "nm", "nauticalmiles": "nm", "milhanautica": "nm", "milha náutica": "nm", "nm": "nm",
}

# Velocidades: fatores para metros por segundo (m/s) como base
_SPEED_TO_MPS: Dict[str, float] = {
	"mps": 1.0,               # metros por segundo
	"kmh": 1000.0 / 3600.0,   # quilômetros por hora
	"mph": 1609.344 / 3600.0, # milhas por hora
	"fps": 0.3048,            # pés por segundo
	"kt": 1852.0 / 3600.0,    # nós (knots) = NM/h
}

_SPEED_ALIASES: Dict[str, str] = {
	"m/s": "mps", "ms-1": "mps", "metrosporsegundo": "mps", "metros por segundo": "mps", "mps": "mps",
	"km/h": "kmh", "kmh": "kmh", "quilometrosporhora": "kmh", "quilômetros por hora": "kmh", "quilometros por hora": "kmh",
	"mph": "mph", "milhasporhora": "mph", "milhas por hora": "mph",
	"ft/s": "fps", "fps": "fps", "pesporsegundo": "fps", "pés por segundo": "fps", "pes por segundo": "fps",
	"kt": "kt", "knot": "kt", "knots": "kt", "nó": "kt", "nos": "kt", "nós": "kt",
}


def normalize_unit(unit: str) -> Optional[str]:
	if not isinstance(unit, str):
		return None
	key = unit.strip().lower().replace(" ", "")
	return _ALIASES.get(key, unit.strip().lower()) if key in _ALIASES else (unit.strip().lower() if unit.strip().lower() in _LENGTH_TO_METERS else None)

def normalize_speed_unit(unit: str) -> Optional[str]:
	if not isinstance(unit, str):
		return None
	key = unit.strip().lower()
	key_no_space = key.replace(" ", "")
	if key_no_space in _SPEED_ALIASES:
		return _SPEED_ALIASES[key_no_space]
	if key in _SPEED_TO_MPS:
		return key
	return None


def convert_length(value: float, from_unit: str, to_unit: str) -> Tuple[float, float]:
	"""
	Converte um valor de comprimento entre unidades suportadas.
	Retorna (resultado, fator_total), onde:
	- resultado = value * fator_total
	- fator_total = (metros_por_from)⁻¹ * (metros_por_to)
	"""
	u_from = normalize_unit(from_unit)
	u_to = normalize_unit(to_unit)
	if u_from is None or u_to is None:
		raise ValueError("Unidade inválida")
	m_from = _LENGTH_TO_METERS[u_from]
	m_to = _LENGTH_TO_METERS[u_to]
	# value em 'from' → metros → 'to'
	in_meters = value * m_from
	result = in_meters / m_to
	# fator_total tal que result = value * fator_total
	factor = (m_from / m_to)
	return result, factor


def convert_length_all(value: float, from_unit: str) -> Dict[str, float]:
	u_from = normalize_unit(from_unit)
	if u_from is None:
		raise ValueError("Unidade inválida")
	m_from = _LENGTH_TO_METERS[u_from]
	in_meters = value * m_from
	return {u: in_meters / m for u, m in _LENGTH_TO_METERS.items()}


def convert_speed(value: float, from_unit: str, to_unit: str) -> Tuple[float, float]:
	"""
	Converte um valor de velocidade entre unidades suportadas.
	Base: m/s. Retorna (resultado, fator_total).
	"""
	u_from = normalize_speed_unit(from_unit)
	u_to = normalize_speed_unit(to_unit)
	if u_from is None or u_to is None:
		raise ValueError("Unidade inválida")
	s_from = _SPEED_TO_MPS[u_from]
	s_to = _SPEED_TO_MPS[u_to]
	in_mps = value * s_from
	result = in_mps / s_to
	factor = (s_from / s_to)
	return result, factor


def convert_speed_all(value: float, from_unit: str) -> Dict[str, float]:
	u_from = normalize_speed_unit(from_unit)
	if u_from is None:
		raise ValueError("Unidade inválida")
	s_from = _SPEED_TO_MPS[u_from]
	in_mps = value * s_from
	return {u: in_mps / s for u, s in _SPEED_TO_MPS.items()}

# ================== Temperatura ==================

_TEMP_ALIASES: Dict[str, str] = {
	"k": "k", "kelvin": "k",
	"c": "c", "celcius": "c", "celsius": "c", "grauscelsius": "c", "graus celsius": "c", "grau celsius": "c",
	"f": "f", "fahrenheit": "f", "grausfahrenheit": "f", "graus fahrenheit": "f",
}

def normalize_temp_unit(unit: str) -> Optional[str]:
	if not isinstance(unit, str):
		return None
	key = unit.strip().lower()
	key_no_space = key.replace(" ", "")
	if key_no_space in _TEMP_ALIASES:
		return _TEMP_ALIASES[key_no_space]
	if key in _TEMP_ALIASES:
		return _TEMP_ALIASES[key]
	return None

def _c_to_k(c: float) -> float:
	return c + 273.15

def _k_to_c(k: float) -> float:
	return k - 273.15

def _c_to_f(c: float) -> float:
	return c * 9.0 / 5.0 + 32.0

def _f_to_c(f: float) -> float:
	return (f - 32.0) * 5.0 / 9.0

def convert_temperature(value: float, from_unit: str, to_unit: str) -> Tuple[float, Optional[float]]:
	u_from = normalize_temp_unit(from_unit)
	u_to = normalize_temp_unit(to_unit)
	if u_from is None or u_to is None:
		raise ValueError("Unidade inválida")
	# Converte para Celsius como pivot
	if u_from == "c":
		c = value
	elif u_from == "k":
		c = _k_to_c(value)
	else:  # "f"
		c = _f_to_c(value)

	# De Celsius para destino
	if u_to == "c":
		result = c
	elif u_to == "k":
		result = _c_to_k(c)
	else:  # "f"
		result = _c_to_f(c)
	# Para temperaturas não há fator linear único, retornamos None
	return result, None

def convert_temperature_all(value: float, from_unit: str) -> Dict[str, float]:
	u_from = normalize_temp_unit(from_unit)
	if u_from is None:
		raise ValueError("Unidade inválida")
	# Converte para Celsius pivot
	if u_from == "c":
		c = value
	elif u_from == "k":
		c = _k_to_c(value)
	else:
		c = _f_to_c(value)
	return {
		"c": c,
		"k": _c_to_k(c),
		"f": _c_to_f(c),
	}

# ================== Massa / Peso ==================

_MASS_TO_KG: Dict[str, float] = {
	"mg": 1e-6,              # miligrama
	"g": 1e-3,               # grama
	"kg": 1.0,               # quilograma
	"ton": 1000.0,           # tonelada (métrica)
	"lb": 0.45359237,        # libra (avoirdupois)
	"oz": 0.028349523125,    # onça (avoirdupois)
}

_MASS_ALIASES: Dict[str, str] = {
	"miligramas": "mg", "miligramas": "mg", "miligramas": "mg", "mg": "mg",
	"miligramas": "mg", "miligramas": "mg", "miligramas": "mg",
	"milligram": "mg", "milligrams": "mg",
	"grama": "g", "gramas": "g", "g": "g", "gram": "g", "grams": "g",
	"quilograma": "kg", "quilogramas": "kg", "kg": "kg", "kilogram": "kg", "kilograms": "kg",
	"tonelada": "ton", "toneladas": "ton", "ton": "ton", "t": "ton",
	"libra": "lb", "libras": "lb", "lb": "lb", "lbs": "lb", "pound": "lb", "pounds": "lb",
	"onca": "oz", "onças": "oz", "onça": "oz", "oz": "oz", "ounce": "oz", "ounces": "oz",
}

def normalize_mass_unit(unit: str) -> Optional[str]:
	if not isinstance(unit, str):
		return None
	key = unit.strip().lower()
	key_no_space = key.replace(" ", "").replace("ç", "c")
	if key_no_space in _MASS_ALIASES:
		return _MASS_ALIASES[key_no_space]
	if key in _MASS_TO_KG:
		return key
	return None

def convert_mass(value: float, from_unit: str, to_unit: str) -> Tuple[float, float]:
	u_from = normalize_mass_unit(from_unit)
	u_to = normalize_mass_unit(to_unit)
	if u_from is None or u_to is None:
		raise ValueError("Unidade inválida")
	k_from = _MASS_TO_KG[u_from]
	k_to = _MASS_TO_KG[u_to]
	in_kg = value * k_from
	result = in_kg / k_to
	factor = (k_from / k_to)
	return result, factor

def convert_mass_all(value: float, from_unit: str) -> Dict[str, float]:
	u_from = normalize_mass_unit(from_unit)
	if u_from is None:
		raise ValueError("Unidade inválida")
	k_from = _MASS_TO_KG[u_from]
	in_kg = value * k_from
	return {u: in_kg / k for u, k in _MASS_TO_KG.items()}

# ================== Tempo ==================

_TIME_TO_SECONDS: Dict[str, float] = {
	"s": 1.0,          # segundos
	"m": 60.0,         # minutos
	"h": 3600.0,       # horas
}

_TIME_ALIASES: Dict[str, str] = {
	"s": "s", "sec": "s", "second": "s", "seconds": "s", "seg": "s", "segundo": "s", "segundos": "s",
	"m": "m", "min": "m", "minute": "m", "minutes": "m", "minuto": "m", "minutos": "m",
	"h": "h", "hr": "h", "hrs": "h", "hour": "h", "hours": "h", "hora": "h", "horas": "h",
}

def normalize_time_unit(unit: str) -> Optional[str]:
	if not isinstance(unit, str):
		return None
	key = unit.strip().lower()
	key_no_space = key.replace(" ", "")
	if key_no_space in _TIME_ALIASES:
		return _TIME_ALIASES[key_no_space]
	if key in _TIME_TO_SECONDS:
		return key
	return None

def convert_time(value: float, from_unit: str, to_unit: str) -> Tuple[float, float]:
	u_from = normalize_time_unit(from_unit)
	u_to = normalize_time_unit(to_unit)
	if u_from is None or u_to is None:
		raise ValueError("Unidade inválida")
	s_from = _TIME_TO_SECONDS[u_from]
	s_to = _TIME_TO_SECONDS[u_to]
	in_seconds = value * s_from
	result = in_seconds / s_to
	factor = (s_from / s_to)
	return result, factor

def convert_time_all(value: float, from_unit: str) -> Dict[str, float]:
	u_from = normalize_time_unit(from_unit)
	if u_from is None:
		raise ValueError("Unidade inválida")
	s_from = _TIME_TO_SECONDS[u_from]
	in_seconds = value * s_from
	return {u: in_seconds / s for u, s in _TIME_TO_SECONDS.items()}

# ================== Pressão ==================

_PRESSURE_TO_PA: Dict[str, float] = {
	"pa": 1.0,           # pascal
	"bar": 1e5,          # bar
	"psi": 6894.757293,  # libra-força por polegada quadrada
}

_PRESSURE_ALIASES: Dict[str, str] = {
	"pa": "pa", "pascal": "pa", "pascals": "pa",
	"bar": "bar", "bars": "bar",
	"psi": "psi", "lbf/in2": "psi", "lbf/in^2": "psi",
}

def normalize_pressure_unit(unit: str) -> Optional[str]:
	if not isinstance(unit, str):
		return None
	key = unit.strip().lower()
	key_no_space = key.replace(" ", "")
	# aceitar "PSI", "Pa" etc (case insensitive já tratado)
	if key_no_space in _PRESSURE_ALIASES:
		return _PRESSURE_ALIASES[key_no_space]
	if key in _PRESSURE_TO_PA:
		return key
	return None

def convert_pressure(value: float, from_unit: str, to_unit: str) -> Tuple[float, float]:
	u_from = normalize_pressure_unit(from_unit)
	u_to = normalize_pressure_unit(to_unit)
	if u_from is None or u_to is None:
		raise ValueError("Unidade inválida")
	p_from = _PRESSURE_TO_PA[u_from]
	p_to = _PRESSURE_TO_PA[u_to]
	in_pa = value * p_from
	result = in_pa / p_to
	factor = (p_from / p_to)
	return result, factor

def convert_pressure_all(value: float, from_unit: str) -> Dict[str, float]:
	u_from = normalize_pressure_unit(from_unit)
	if u_from is None:
		raise ValueError("Unidade inválida")
	p_from = _PRESSURE_TO_PA[u_from]
	in_pa = value * p_from
	return {u: in_pa / p for u, p in _PRESSURE_TO_PA.items()}

# ================== Torque ==================

_TORQUE_TO_NM: Dict[str, float] = {
	"n.m": 1.0,            # newton-metro
	"kgf.cm": 0.0980665,   # quilograma-força centímetro
	"kgf.m": 9.80665,      # quilograma-força metro
}

_TORQUE_ALIASES: Dict[str, str] = {
	"n.m": "n.m", "n*m": "n.m", "n·m": "n.m", "nm": "n.m",
	"kgf.cm": "kgf.cm", "kgf*cm": "kgf.cm", "kgf·cm": "kgf.cm", "kgfcm": "kgf.cm",
	"kgf.m": "kgf.m", "kgf*m": "kgf.m", "kgf·m": "kgf.m", "kgfm": "kgf.m",
}

def normalize_torque_unit(unit: str) -> Optional[str]:
	if not isinstance(unit, str):
		return None
	key = unit.strip().lower().replace(" ", "")
	# normaliza ponto médio e asterisco
	key = key.replace("·", ".").replace("*", ".")
	if key in _TORQUE_ALIASES:
		return _TORQUE_ALIASES[key]
	if key in _TORQUE_TO_NM:
		return key
	return None

def convert_torque(value: float, from_unit: str, to_unit: str) -> Tuple[float, float]:
	u_from = normalize_torque_unit(from_unit)
	u_to = normalize_torque_unit(to_unit)
	if u_from is None or u_to is None:
		raise ValueError("Unidade inválida")
	t_from = _TORQUE_TO_NM[u_from]
	t_to = _TORQUE_TO_NM[u_to]
	in_nm = value * t_from
	result = in_nm / t_to
	factor = (t_from / t_to)
	return result, factor

def convert_torque_all(value: float, from_unit: str) -> Dict[str, float]:
	u_from = normalize_torque_unit(from_unit)
	if u_from is None:
		raise ValueError("Unidade inválida")
	t_from = _TORQUE_TO_NM[u_from]
	in_nm = value * t_from
	return {u: in_nm / t for u, t in _TORQUE_TO_NM.items()}

# ================== Carga Elétrica ==================

_CHARGE_TO_AH: Dict[str, float] = {
	"mah": 1e-3,           # miliamperes-hora
	"ah": 1.0,             # amperes-hora
	"c": 1.0 / 3600.0,     # coulombs (1 Ah = 3600 C)
}

_CHARGE_ALIASES: Dict[str, str] = {
	"mah": "mah", "mah": "mah", "miliamperehora": "mah", "miliamperes-hora": "mah", "miliamperes hora": "mah",
	"milliamperehour": "mah", "milliampere-hour": "mah", "milliampere hour": "mah", "mah": "mah",
	"ah": "ah", "amperehora": "ah", "amperes-hora": "ah", "amperes hora": "ah",
	"amperehour": "ah", "ampere-hour": "ah", "ampere hour": "ah", "ah": "ah",
	"c": "c", "coulomb": "c", "coulombs": "c", "coul": "c",
}

def normalize_charge_unit(unit: str) -> Optional[str]:
	if not isinstance(unit, str):
		return None
	key = unit.strip().lower().replace(" ", "").replace("-", "")
	if key in _CHARGE_ALIASES:
		return _CHARGE_ALIASES[key]
	if key in _CHARGE_TO_AH:
		return key
	return None

def convert_charge(value: float, from_unit: str, to_unit: str) -> Tuple[float, float]:
	u_from = normalize_charge_unit(from_unit)
	u_to = normalize_charge_unit(to_unit)
	if u_from is None or u_to is None:
		raise ValueError("Unidade inválida")
	c_from = _CHARGE_TO_AH[u_from]
	c_to = _CHARGE_TO_AH[u_to]
	in_ah = value * c_from
	result = in_ah / c_to
	factor = (c_from / c_to)
	return result, factor

def convert_charge_all(value: float, from_unit: str) -> Dict[str, float]:
	u_from = normalize_charge_unit(from_unit)
	if u_from is None:
		raise ValueError("Unidade inválida")
	c_from = _CHARGE_TO_AH[u_from]
	in_ah = value * c_from
	return {u: in_ah / c for u, c in _CHARGE_TO_AH.items()}

# ================== Energia Elétrica ==================

_ENERGY_TO_WH: Dict[str, float] = {
	"mwh": 1e-3,           # miliwatts-hora
	"wh": 1.0,             # watts-hora
	"kwh": 1000.0,         # quilowatts-hora
	"j": 1.0 / 3600.0,     # joules (1 Wh = 3600 J)
}

_ENERGY_ALIASES: Dict[str, str] = {
	"mwh": "mwh", "miliwatthora": "mwh", "miliwatts-hora": "mwh", "miliwatts hora": "mwh",
	"milliwatthour": "mwh", "milliwatt-hour": "mwh", "milliwatt hour": "mwh", "mwh": "mwh",
	"wh": "wh", "watthora": "wh", "watts-hora": "wh", "watts hora": "wh",
	"watthour": "wh", "watt-hour": "wh", "watt hour": "wh", "wh": "wh",
	"kwh": "kwh", "quilowatthora": "kwh", "quilowatts-hora": "kwh", "quilowatts hora": "kwh",
	"kilowatthour": "kwh", "kilowatt-hour": "kwh", "kilowatt hour": "kwh", "kwh": "kwh",
	"j": "j", "joule": "j", "joules": "j",
}

def normalize_energy_unit(unit: str) -> Optional[str]:
	if not isinstance(unit, str):
		return None
	key = unit.strip().lower().replace(" ", "").replace("-", "")
	if key in _ENERGY_ALIASES:
		return _ENERGY_ALIASES[key]
	if key in _ENERGY_TO_WH:
		return key
	return None

def convert_energy(value: float, from_unit: str, to_unit: str) -> Tuple[float, float]:
	u_from = normalize_energy_unit(from_unit)
	u_to = normalize_energy_unit(to_unit)
	if u_from is None or u_to is None:
		raise ValueError("Unidade inválida")
	e_from = _ENERGY_TO_WH[u_from]
	e_to = _ENERGY_TO_WH[u_to]
	in_wh = value * e_from
	result = in_wh / e_to
	factor = (e_from / e_to)
	return result, factor

def convert_energy_all(value: float, from_unit: str) -> Dict[str, float]:
	u_from = normalize_energy_unit(from_unit)
	if u_from is None:
		raise ValueError("Unidade inválida")
	e_from = _ENERGY_TO_WH[u_from]
	in_wh = value * e_from
	return {u: in_wh / e for u, e in _ENERGY_TO_WH.items()}

