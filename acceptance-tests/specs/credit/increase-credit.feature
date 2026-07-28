Feature: Increase account credit
  As a registered user
  I want to increase my account's SMS credit
  So that I can send SMS

  Background:
    Given Ariana is a registered user
    And Ariana's account credit is 0

  Scenario: Successfully increasing account credit
    When Ariana adds 50000 Rials to his account credit
    Then Ariana's account credit becomes 50000 Rials
