"""The compatibility questions people can answer, shared with the client via the API.

Ids are stable: answers are stored against them, so a question's wording can change but
its id and the meaning of its options can't.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class Question:
    id: str
    text: str
    options: tuple[str, ...]
    topic: str


QUESTIONS: tuple[Question, ...] = (
    Question("kids", "Do you want children someday?", ("Yes", "No", "Not sure yet"), "Life"),
    Question(
        "pets",
        "Could you live with a pet?",
        ("Love to", "If it's small", "Rather not"),
        "Life",
    ),
    Question(
        "city_or_country",
        "Where would you rather live?",
        ("Big city", "Small town", "Countryside"),
        "Life",
    ),
    Question(
        "weekend",
        "A perfect weekend is mostly…",
        ("Out and about", "A bit of both", "Cosy at home"),
        "Lifestyle",
    ),
    Question(
        "morning",
        "Are you a morning person?",
        ("Up with the sun", "Depends on the day", "Night owl"),
        "Lifestyle",
    ),
    Question("tidy", "How tidy are you?", ("Very", "Tidy enough", "Creative chaos"), "Lifestyle"),
    Question(
        "drinking",
        "How often do you drink?",
        ("Never", "Socially", "Most weekends"),
        "Lifestyle",
    ),
    Question("smoking", "Do you smoke?", ("No", "Sometimes", "Yes"), "Lifestyle"),
    Question(
        "exercise",
        "How active are you?",
        ("Every day", "A few times a week", "Rarely"),
        "Lifestyle",
    ),
    Question(
        "travel",
        "How do you like to travel?",
        ("Plan every detail", "Rough plan, then wing it", "Just go"),
        "Lifestyle",
    ),
    Question(
        "texting",
        "How much texting between dates?",
        ("All day", "A few messages", "Save it for in person"),
        "Dating",
    ),
    Question(
        "first_date",
        "Ideal first date?",
        ("Coffee", "Drinks", "An activity"),
        "Dating",
    ),
    Question(
        "pace",
        "How fast do you like things to move?",
        ("Slow and steady", "Let it happen", "I know quickly"),
        "Dating",
    ),
    Question(
        "looking_for",
        "What are you looking for right now?",
        ("Something long-term", "Open to see", "Something casual"),
        "Dating",
    ),
    Question(
        "split_bill",
        "Who pays on a first date?",
        ("Split it", "Whoever asked", "Take turns"),
        "Dating",
    ),
    Question(
        "argue",
        "In a disagreement you…",
        ("Talk it out straight away", "Need a little space first", "Avoid it"),
        "Values",
    ),
    Question(
        "faith",
        "How important is faith or spirituality to you?",
        ("Very", "Somewhat", "Not at all"),
        "Values",
    ),
    Question(
        "politics",
        "How much do politics matter in a partner?",
        ("A lot", "A little", "Not at all"),
        "Values",
    ),
    Question(
        "ambition",
        "Career right now is…",
        ("My main focus", "Important, in balance", "Just a job"),
        "Values",
    ),
    Question(
        "friends",
        "How much time with friends?",
        ("Loads, they're family", "A healthy amount", "I'm a homebody"),
        "Values",
    ),
)

BY_ID: dict[str, Question] = {q.id: q for q in QUESTIONS}

# How much a question counts towards agreement, by how much its answerer says it matters.
IMPORTANCE_WEIGHTS = (1, 10, 50)
IMPORTANCE_LABELS = ("A little", "Somewhat", "Very")
# Below this many questions in common there isn't enough to say anything.
MIN_COMMON_QUESTIONS = 3
