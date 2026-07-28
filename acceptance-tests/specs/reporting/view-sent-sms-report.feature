Feature: View sent SMS report
  As a registered user
  I want to view a report of the SMS I've sent
  So that I know the status of my sends

  Background:
    Given Ariana is a registered user

  Scenario: Viewing the report after sending an SMS
    Given Ariana has sent an SMS to "09121234567"
    When Ariana requests his sent SMS report
    Then the SMS sent to "09121234567" appears in his report

  Scenario: Not seeing other users' SMS in the report
    Given Fateme is a registered user
    And Fateme has sent an SMS to "09359999999"
    When Ariana requests his sent SMS report
    Then Fateme's SMS does not appear in Ariana's report
