import re
from itertools import combinations
import statistics

# --- DATA STRUCTURES ---

class TimeSlot:
    days_map = {'mo': 0, 'tu': 1, 'we': 2, 'th': 3, 'fr': 4, 'sa': 5, 'su': 6}
    
    def __init__(self, day_str, start_str, end_str):
        self.day = self.days_map[day_str.lower()]
        self.day_str = day_str
        self.start = self._parse_time(start_str)
        self.end = self._parse_time(end_str)

    def _parse_time(self, t_str):
        if ':' in t_str:
            h, m = map(int, t_str.split(':'))
            return h + m / 60.0
        return float(t_str)

    def overlaps(self, other):
        if self.day != other.day:
            return False
        return self.start < other.end and other.start < self.end

    def __repr__(self):
        return f"{self.day_str} {self.start:g}-{self.end:g}"

class CourseOption:
    def __init__(self, option_id, slots):
        self.option_id = option_id
        self.slots = slots

    def overlaps_with_option(self, other_option):
        for s1 in self.slots:
            for s2 in other_option.slots:
                if s1.overlaps(s2):
                    return True
        return False

class Course:
    def __init__(self, name, options):
        self.name = name
        self.options = options

# --- PARSING & SOLVER ---

def calculate_daily_balance(schedule):
    """
    Calcula la desviación estándar de las horas de clase por día.
    Un valor cercano a 0 significa que todos los días haces las mismas horas.
    """
    hours_per_day = {0: 0, 1: 0, 2: 0, 3: 0, 4: 0}
    
    for name, option in schedule:
        for slot in option.slots:
            # Duración del bloque (ej: 10-12 = 2 horas)
            hours_per_day[slot.day] += (slot.end - slot.start)
    
    # Obtenemos la lista de horas (ej: [4, 6, 4, 4, 6])
    counts = list(hours_per_day.values())
    
    # Si quieres evitar días con 0 horas (si no hay día libre), 
    # esto penalizará la desigualdad.
    return statistics.stdev(counts)


# --- NUEVA FUNCIÓN PARA MINIMIZAR VIAJES ---

def parse_course_string(input_str):
    parts = input_str.split(',')
    first_part_tokens = parts[0].strip().split()
    course_name = first_part_tokens[0]
    parts[0] = " ".join(first_part_tokens[1:])

    options = []
    pattern = r'(mo|tu|we|th|fr|sa|su)\s+(\d+(?::\d+)?(?:\.\d+)?)-(\d+(?::\d+)?(?:\.\d+)?)'
    group_pattern = r'\[(.*?)\]'  # ← captura el grup

    for part in parts:
        part = part.strip()

        # 1. Extreure grup personalitzat
        group_match = re.search(group_pattern, part)
        if not group_match:
            continue
        group_id = group_match.group(1)

        # 2. Extreure horaris
        matches = re.findall(pattern, part.lower())
        if not matches:
            continue

        slots = [TimeSlot(day, start, end) for day, start, end in matches]
        options.append(CourseOption(group_id, slots))

    return Course(course_name, options)

def solve_timetable(courses):
    valid_timetables = []
    
    def backtrack(course_index, current_schedule):
        if course_index == len(courses):
            valid_timetables.append(list(current_schedule))
            return

        current_course = courses[course_index]
        for option in current_course.options:
            is_compatible = True
            for _, selected_option in current_schedule:
                if option.overlaps_with_option(selected_option):
                    is_compatible = False
                    break
            
            if is_compatible:
                current_schedule.append((current_course.name, option))
                backtrack(course_index + 1, current_schedule)
                current_schedule.pop()

    backtrack(0, [])
    return valid_timetables

# --- OPTIMIZATION & PREFERENCES ---


def satisfies_time_prefs(schedule, min_start, max_end, avoid_day_idx):
    for _, option in schedule:
        for slot in option.slots:
            if slot.start < min_start: return False
            if slot.end > max_end: return False
            if avoid_day_idx != -1 and slot.day == avoid_day_idx: return False
    return True

def calculate_total_gaps(schedule):
    """Calculates total hours of empty gaps between classes per day."""
    day_slots = {i: [] for i in range(5)} # 0=Mon to 4=Fri
    
    # 1. Collect all slots for the week
    for _, option in schedule:
        for slot in option.slots:
            if 0 <= slot.day <= 4:
                day_slots[slot.day].append((slot.start, slot.end))
    
    total_gaps = 0.0
    
    # 2. Calculate gaps for each day
    for day in day_slots:
        slots = day_slots[day]
        if not slots:
            continue
            
        # Sort by start time
        slots.sort(key=lambda x: x[0])
        
        # Sum the time between End of current and Start of next
        for i in range(len(slots) - 1):
            current_end = slots[i][1]
            next_start = slots[i+1][0]
            
            # (Optional safety check: max(0, ...))
            gap = max(0.0, next_start - current_end)
            total_gaps += gap
            
    return total_gaps

# --- FILE WRITING FUNCTION ---

def write_schedule_to_file(f, schedule, sol_id, gap_score, balance_score):
    f.write("\n\nSelected groups:\n")
    for c_name, option in schedule:
        f.write(f"  - {c_name}: Group {option.option_id}\n")
    f.write("\n")


    f.write(f"{'='*82}\n")
    # Header now includes the Gap Score
    f.write(f"   TIMETABLE #{sol_id} | Gap Time: {gap_score:g}h | Balance: {balance_score}\n")
    f.write(f"{'='*82}\n\n")

    days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
    start_hour = 8
    end_hour = 21
    
    grid = {h: [""] * 5 for h in range(start_hour, end_hour)}

    for c_name, option in schedule:
        short_name = c_name[:12]
        for slot in option.slots:
            s_h = int(slot.start)
            e_h = int(slot.end)
            if slot.end % 1 > 0:
                e_h += 1
            
            for h in range(s_h, e_h):
                if h in grid:
                    if grid[h][slot.day]:
                        grid[h][slot.day] += "/" + short_name
                    else:
                        grid[h][slot.day] = short_name

    header = f"{'Time':<5} | " + " | ".join(f"{d:^12}" for d in days) + " |"
    divider = "-" * len(header)
    
    f.write(divider + "\n")
    f.write(header + "\n")
    f.write(divider + "\n")

    for h in range(start_hour, end_hour):
        time_label = f"{h:02d}:00"
        row_cells = []
        for d_idx in range(5):
            cell_content = grid[h][d_idx]
            row_cells.append(f"{cell_content:^12}")
        
        row_str = f"{time_label:<5} | " + " | ".join(row_cells) + " |"
        f.write(row_str + "\n")

    f.write(divider + "\n")

def ask_allowed_groups(courses):
    """
    Pregunta a l'usuari quins grups vol permetre per cada assignatura.
    Retorna un diccionari: { "SO": {"11", "12"}, ... }
    """
    allowed = {}

    print("\nSelecció de grups disponibles")
    print("=" * 40)

    for course in courses:
        all_groups = sorted(option.option_id for option in course.options)
        groups_str = " ".join(all_groups)

        print(f"\n{course.name}")
        print(f"Grups disponibles: {groups_str}")
        user_input = input(
            f"Quins grups vols per {course.name}? "
            "(separats per espais, Enter = tots): "
        ).strip()

        if user_input == "":
            allowed[course.name] = set(all_groups)
        else:
            chosen = set(user_input.split())
            valid = chosen & set(all_groups)

            if not valid:
                print("⚠️ Cap grup vàlid, s'usaran TOTS.")
                allowed[course.name] = set(all_groups)
            else:
                allowed[course.name] = valid

    return allowed

def filter_courses_by_groups(courses, allowed_groups):
    filtered = []

    for course in courses:
        allowed = allowed_groups.get(course.name, set())
        new_options = [
            option for option in course.options
            if option.option_id in allowed
        ]

        # Només afegim l'assignatura si queda almenys un grup
        if new_options:
            filtered.append(Course(course.name, new_options))
        else:
            print(f"⚠️ {course.name} eliminada (cap grup permès)")

    return filtered

def get_time_preferences():
    print("\n--- Preferències horàries (Enter = sense restriccions) ---")

    latest_end = input("Hora màxima de finalització (ex: 18): ").strip()
    max_end = float(latest_end) if latest_end else 24.0

    earliest_start = input("Hora mínima d'inici (ex: 9): ").strip()
    min_start = float(earliest_start) if earliest_start else 0.0

    free_day_input = input("Dia lliure (mo tu we th fr, Enter = cap): ").strip().lower()
    days_map = {'mo': 0, 'tu': 1, 'we': 2, 'th': 3, 'fr': 4}
    avoid_day_idx = days_map.get(free_day_input, -1)

    return min_start, max_end, avoid_day_idx

def satisfies_time_prefs_with_extension(schedule, min_start, max_end, avoid_day_idx, day_extensions):
    for _, option in schedule:
        for slot in option.slots:
            if slot.start < min_start:
                return False

            allowed_end = max_end + day_extensions.get(slot.day, 0)
            if slot.end > allowed_end:
                return False

            if avoid_day_idx != -1 and slot.day == avoid_day_idx:
                return False

    return True

def generate_day_extension_sets(extra_hours):
    days = list(range(5))  # dilluns a divendres

    for k in range(1, 6):  # 1 dia → 5 dies
        for combo in combinations(days, k):
            yield {day: extra_hours for day in combo}

def find_solutions_with_relaxation(solutions, min_start, max_end, avoid_day_idx, max_extra_hours=6):
    results = []
    for sol in solutions:
        if satisfies_time_prefs(sol, min_start, max_end, avoid_day_idx):
            results.append((
                calculate_total_gaps(sol),
                calculate_daily_balance(sol),
                sol
            ))

    if results:
        return results, None

    # 1️⃣ Relaxació progressiva
    for extra_hours in range(1, max_extra_hours + 1):
        for day_extensions in generate_day_extension_sets(extra_hours):
            relaxed = []

            for sol in solutions:
                if satisfies_time_prefs_with_extension(
                    sol,
                    min_start,
                    max_end,
                    avoid_day_idx,
                    day_extensions
                ):
                    relaxed.append((
                        calculate_total_gaps(sol),
                        calculate_daily_balance(sol),
                        sol
                    ))

            if relaxed:
                return relaxed, day_extensions

    return [], None



# --- INPUT DATA ---

# <assignatura> <dia_setmana> <franja_horaria> [<dia_setmana2> <franja_horaria2> ...], 
mandatory_strings = [
    "SO [11] fr 12-14, [12] th 12-14, [13] fr 12-14, [14] th 12-14, [41] we 17-19, [42] th 16-18, [43] th 14-16",
    "AC [11] we 8-10 th 8-9 mo 9-10, [12] we 8-10 th 8-9 fr 13-14, [13] we 8-10 th 8-9 fr 12-13, [14] we 8-10 th 8-10, [21] th 11-14 mo 10-11, [22] th 11-14 mo 11-12, [23] th 11-14 tu 12-13, [24] th 11-14 tu 13-14, [31] tu 8-10 we 10-11, [32] tu 9-11 we 10-11, [33] tu 9-10 we 10-11 fr 9-10, [41] mo 15-17 we 15-17, [42] mo 15-16 we 15-18, [43] mo 14-16 we 15-17",
    "EEE [10] tu 10-12 th 10-12, [20] mo 8-10 we 8-10, [30] mo 10-12 th 8-10, [40] tu 14-16 th 14-16, [50] mo 16-18 we 17-19",
    "IDI [11] tu 8-10 fr 8-10, [12] tu 8-10 fr 8-10, [13] tu 8-10 fr 8-10, [21] tu 10-12 fr 10-12, [22] tu 10-12 fr 10-12, [23] tu 10-12 fr 10-12, [31] tu 12-14 fr 12-14, [32] tu 12-14 fr 12-14, [33] tu 12-14 fr 12-14, [41] tu 18-20 th 17-19, [42] tu 18-20 th 17-19, [43] tu 18-20 th 17-19, [51] tu 16-18 th 16-18, [52] tu 16-18 th 16-18, [53] tu 16-218 th 16-18, [61] tu 14-16 th 14-16, [62] tu 14-16 th 14-16, [63] tu 14-16 th 14-16",
    "IES [11] mo 10-12 fr 12-14, [12] mo 10-12 fr 10-12, [13] mo 10-12 fr 10-12, [14] mo 10-12 th 12-14, [21] mo 12-14 th 8-10, [22] mo 12-14 th 8-10, [23] mo 12-14 fr 12-14, [24] mo 12-14 fr 8-10, [31] mo 8-10 th 12-14, [32] mo 8-10 fr 8-10, [33] mo 8-10 th 10-12, [34] mo 8-10 th 10-12, [41] mo 18-20 fr 16-18, [42] mo 18-20 fr 14-16, [43] mo 18-20 fr 16-18, [44] mo 18-20 fr 14-16",
    "XC [11] tu 12-14 th 9-10 we 10-11, [12] tu 12-14 th 9-10 mo 12-14, [13] tu 12-14 th 9-10 th 12-14, [14] tu 12-14 th 9-10 mo 8-10, [21] tu 8-10 th 10-11 we 10-12, [22] tu 8-10 th 10-11 fr 12-14, [23] tu 8-10 th 10-11 fr 8-10, [24] tu 8-10 th 10-11 mo 10-12, [41] tu 16-18 th 16-17 fr 14-16, [42] tu 16-18 th 16-17 we 18-20, [43] tu 16-18 th 16-17 mo 16-18, [51] mo 14-16 tu 15-16 we 15-17, [52] mo 14-16 tu 15-16 th 14-16, [53] mo 14-16 tu 15-16 th 18-20"
]

min_start_pref, max_end_pref, free_day_pref = get_time_preferences()

# --- MAIN EXECUTION FINAL ---

print(f"\nGenerando horarios con todas las restricciones...")

parsed_courses = [parse_course_string(s) for s in mandatory_strings]

# 1. Preguntar a l'usuari quins grups vol
allowed_groups = ask_allowed_groups(parsed_courses)

# 2. Filtrar assignatures segons els grups escollits
filtered_courses = filter_courses_by_groups(parsed_courses, allowed_groups)

# 3. Generar horaris només amb aquests grups
solutions = solve_timetable(filtered_courses)


all_results, relaxation_used = find_solutions_with_relaxation(
    solutions,
    min_start_pref,
    max_end_pref,
    free_day_pref,
    max_extra_hours=6
)

# ORDENACIÓN: 1º Balance score, 2º Gap score
all_results.sort(key=lambda x: (x[0], x[1]))

filename = "schedule.txt"
with open(filename, "w", encoding="utf-8") as f:
    print("\n")

    if all_results:
        print(f"> ¡Éxito! Encontradas {len(all_results)} combinaciones.")
    else:
        print("No existe ningún horario que cumpla todas las restricciones a la vez.")

    if relaxation_used:
        days = ["Mon", "Tue", "Wed", "Thu", "Fri"]
        used_days = ", ".join(days[d] for d in relaxation_used)
        extra = list(relaxation_used.values())[0]
        print(f"> ⚠️ Restricciones relajadas: +{extra}h en {used_days}")
        
    for i, (gaps, balance, sol) in enumerate(all_results[:50]):
        write_schedule_to_file(f, sol, i+1, gaps, balance)
        
    print(f"> Revisa '{filename}' para ver los resultados.\n")