# Friday around the dentist

Here is the day, the costs and where each page came from.

```openui-lang
root = Parts([plan, table, chart, choice, sources, figure, fold, pictures, note, draft])
plan = Plan("Friday", [Step("Call with Marta", "done", "09:00"), Step("Dentist, Calle Mayor 14", "done", "11:00"), Step("Tax letter, two clear hours", "current", "13:30"), Step("Leave for school pickup", "next", "16:10")])
table = Table("Costs this month", ["Item", "Euros"], [["Dentist", "85"], ["Parking", "12"], ["Total", "97"]], "Parking is estimated.")
chart = Chart("Spending", "euros a month", [Bar("Rent", 900), Bar("Food", 310), Bar("Travel", 74)], "Rent is the largest share.")
choice = Choice("When should the tax letter go out?", [Option("Today", "Before the office closes", true), Option("Monday", "After you re-read it")])
sources = Sources([Source("Tax office opening hours", "https://example.com/hours"), Source("Letter of 3 November")])
figure = Figure("School run", ["Home", "Dentist", "School"], "About 25 minutes in total.")
fold = Fold("How I worked this out", "The dentist runs **40 minutes** and the walk to school takes 15.")
pictures = Pictures([Picture("A one pixel test image", "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="), Picture("A picture Pip could not attach")])
note = Note("Nothing here was sent.", "ok")
draft = Draft("Email, not sent", [Field("To", "Tax office"), Field("Subject", "Your letter of 3 November")], "Dear Sir or Madam, thank you for your letter of 3 November.")
```

The draft is only shown; nothing leaves this Mac.
